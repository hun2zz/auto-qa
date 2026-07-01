import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import type {
  HealChange,
  HealResult,
  HealVerdict,
  NegativeControlReport,
  ProgressEvent,
  RunReport,
  SensitivitySpec,
  TestResult,
  TestScope
} from '@shared/types'
import { getConfig, lastReportPath, qaDir, testsDir, writePlaywrightConfig } from './projectManager'
import { startDevServer, type DevServerHandle } from './devServer'
import { runPlaywright } from './playwrightRunner'
import { runClaude } from './claudeRunner'
import { authEnv } from './auth'
import { composeRules } from './rules'
import { healPrompt, rulesHeader } from './prompts'
import { loadProjectEnv } from './dotenv'
import { restoreSpecImports } from './codeCoverage'

/** url 의 프로토콜/호스트(포트 포함)를 base 의 것으로 교체. 경로/쿼리는 유지. */
function rewriteHost(url: string, base: string): string {
  try {
    const u = new URL(url)
    const b = new URL(base)
    u.protocol = b.protocol
    u.host = b.host
    return u.toString()
  } catch {
    return url
  }
}

/** 진행 중인 runTests 의 AbortController (projectPath 별 1개). 중단용. */
const activeRuns = new Map<string, AbortController>()

/** 진행 중인 runTests 를 중단한다. (Playwright child 종료 → 서버는 finally 에서 정리) */
export function cancelRun(projectPath: string): void {
  activeRuns.get(projectPath)?.abort()
}

/** [결정적] dev 서버 구동 → Playwright 실행 → 리포트 저장. AI 미사용.
 *  only: 단일 spec(문자열) 또는 트랙 실행용 spec 목록(배열). 생략 시 전체 실행. */
export async function runTests(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void,
  only?: string | string[]
): Promise<RunReport> {
  const targets = only == null ? undefined : Array.isArray(only) ? only : [only]
  return doRun(projectPath, onProgress, targets && targets.length ? targets : undefined)
}

/** 직전 리포트의 실패/타임아웃 테스트만 재실행. file:line 정밀 타깃(없으면 파일 단위). */
export async function runFailedTests(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<RunReport> {
  const last = await getLastReport(projectPath)
  const failed = (last?.results ?? []).filter(
    (r) => r.status === 'failed' || r.status === 'timedOut'
  )
  if (failed.length === 0) {
    onProgress({ phase: 'playwright', message: '재실행할 실패 테스트가 없습니다.', done: true })
    return last ?? fatalReport('직전 실행 리포트가 없습니다.')
  }
  // file:line 으로 정밀 타깃. line 이 없는(구버전 리포트) 경우 파일 단위로 폴백.
  const targets = [
    ...new Set(
      failed
        .map((r) => (r.file ? (r.line ? `${r.file}:${r.line}` : r.file) : null))
        .filter((x): x is string => x != null)
    )
  ]
  onProgress({ phase: 'playwright', message: `실패 ${failed.length}건 재실행 (타깃 ${targets.length})` })
  return doRun(projectPath, onProgress, targets)
}

/** runTests / runFailedTests 공통 본문. targets 지정 시 해당 타깃만 실행. */
async function doRun(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void,
  targets?: string[]
): Promise<RunReport> {
  let server: DevServerHandle | null = null
  const controller = new AbortController()
  activeRuns.set(projectPath, controller)
  try {
    // 방어: 직전 커버리지 실행이 비정상 종료돼 spec import 가 커버리지 fixture 로
    // 패치된 채 남아 있으면 일반 실행이 깨진다. 실행 전 원본(@playwright/test)으로 복원.
    const healed = await restoreSpecImports(projectPath)
    if (healed > 0)
      onProgress({ phase: 'playwright', message: `커버리지 잔여 패치 ${healed}개 복원됨` })
    server = await bootDevServer(projectPath, onProgress)
    await runSeedIfEnabled(projectPath, onProgress)
    const extraEnv = await qaEnv(projectPath)
    extraEnv.QA_BASE_URL = server.baseURL // dev 서버가 실제로 띄운 포트로 테스트
    // 로그인 URL 도 실제 서버 포트로 맞춤 (3000 점유 시 3001 등으로 떠도 로그인 성공)
    if (extraEnv.QA_LOGIN_URL) extraEnv.QA_LOGIN_URL = rewriteHost(extraEnv.QA_LOGIN_URL, server.baseURL)
    const stamped = await runAndStamp(projectPath, {
      extraEnv,
      onProgress,
      targets,
      signal: controller.signal
    })
    // 부팅/파싱 실패로 0건이면 기존 리포트를 보존(덮어쓰기 방지).
    if (stamped.fatalError && stamped.total === 0) {
      announce(stamped, onProgress)
      return stamped
    }
    // 부분 실행(targets 지정)은 이전 리포트에 '병합' — 재실행 안 한 결과를 잃지 않게.
    let toSave = stamped
    if (targets && targets.length) {
      const prev = await getLastReport(projectPath)
      if (prev && prev.results.length) toSave = mergeReports(prev, stamped)
    }
    await persist(projectPath, toSave)
    announce(toSave, onProgress)
    return toSave
  } catch (e) {
    const aborted = controller.signal.aborted
    const msg = aborted ? '사용자가 실행을 중단했습니다.' : (e as Error).message
    // 조기 실패(서버 부팅 등)는 결과 0건 → 직전 리포트를 보존하기 위해 persist 하지 않음.
    const report = fatalReport(msg)
    onProgress({ phase: 'devserver', message: msg, error: true, done: true })
    return report
  } finally {
    activeRuns.delete(projectPath)
    server?.stop()
  }
}

/**
 * [AI + 결정적] self-healing: 실행 → 실패한 spec 의 셀렉터를 AI 가 고침 → 재실행.
 * AI 는 '셀렉터 수정'만 하고 assertion 의도는 유지(거짓 통과 방지).
 */
export async function healAndRerun(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void,
  only?: string[]
): Promise<HealResult> {
  let server: DevServerHandle | null = null
  const notes: string[] = []
  const targets = only && only.length ? only : undefined
  const partial = !!targets
  // 부분 힐링이면 결과를 이전 리포트에 병합해 나머지 테스트 결과를 보존한다.
  const finalize = async (report: RunReport): Promise<RunReport> => {
    let out = report
    if (partial && !(report.fatalError && report.total === 0)) {
      const prev = await getLastReport(projectPath)
      if (prev && prev.results.length) out = mergeReports(prev, report)
    }
    await persist(projectPath, out)
    return out
  }
  try {
    server = await bootDevServer(projectPath, onProgress)
    await runSeedIfEnabled(projectPath, onProgress)
    const extraEnv = await qaEnv(projectPath)
    extraEnv.QA_BASE_URL = server.baseURL // dev 서버가 실제로 띄운 포트로 테스트
    // 로그인 URL 도 실제 서버 포트로 맞춤 (3000 점유 시 3001 등으로 떠도 로그인 성공)
    if (extraEnv.QA_LOGIN_URL) extraEnv.QA_LOGIN_URL = rewriteHost(extraEnv.QA_LOGIN_URL, server.baseURL)

    // 1차 실행 (부분 힐링이면 선택 대상만)
    let report = await runAndStamp(projectPath, { extraEnv, onProgress, targets })
    const failedFiles = groupFailingFiles(report.results)

    if (failedFiles.size === 0) {
      const merged = await finalize(report)
      return {
        attempted: 0,
        healed: 0,
        realBugs: 0,
        report: merged,
        changes: [],
        notes: ['선택한 범위에 실패한 테스트가 없습니다.']
      }
    }

    // 2. 실패 spec 별로 분류·치유 (최대 5개 파일). 드리프트만 고치고, 회귀는 되돌려서 절대 세탁 금지.
    const rules = rulesHeader(await composeRules(projectPath, 'healing'))
    const changes: HealChange[] = []
    let attempted = 0
    let healed = 0
    let realBugs = 0
    for (const [file, failures] of [...failedFiles].slice(0, 5)) {
      const specPath = resolveSpecPath(projectPath, file)
      if (!specPath) {
        changes.push({ file, verdict: 'skipped', summary: 'spec 경로를 찾지 못함' })
        continue
      }
      attempted++
      onProgress({ phase: 'tests', message: `분류·수정 중: ${file}` })
      const before = await fs.readFile(specPath, 'utf8').catch(() => '')
      const res = await runClaude({
        projectPath,
        prompt:
          rules +
          healPrompt({
            specPath,
            storageStateRel: null,
            failures: failures.map((f) => `- ${f.title}: ${trim(f.error)}`).join('\n')
          }),
        allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
        phase: 'tests',
        onProgress
      })
      const summary = firstLine((res.summary || '').trim())
      const after = await fs.readFile(specPath, 'utf8').catch(() => before)
      const fileChanged = after !== before
      const isRegression = /^REAL_BUG/i.test(summary)

      let verdict: HealVerdict
      if (isRegression) {
        // 회귀: AI 가 혹시 파일을 바꿨어도 '되돌린다'. 회귀를 절대 초록으로 세탁하지 않음.
        if (fileChanged) await fs.writeFile(specPath, before, 'utf8')
        verdict = 'real_bug'
        realBugs++
      } else if (res.ok && fileChanged && /^HEALED/i.test(summary)) {
        verdict = 'healed'
        healed++
      } else {
        // HEALED 라 했지만 변경 없음 / SKIPPED / 실패 → 적용 안 함
        if (fileChanged && !res.ok) await fs.writeFile(specPath, before, 'utf8') // 실패 시 변경 폐기
        verdict = 'skipped'
      }
      changes.push({
        file,
        verdict,
        summary: summary || (res.ok ? '처리됨' : res.error || '실패'),
        diff: verdict === 'healed' ? lineDiff(before, after) : undefined
      })
      notes.push(`[${verdict}] ${file} — ${summary}`)
    }

    // 3. 드리프트 수정이 있었으면 재실행 (회귀 spec 은 안 고쳤으니 그대로 실패 유지)
    if (healed > 0) {
      onProgress({ phase: 'playwright', message: '드리프트 수정본 재실행 중…' })
      report = await runAndStamp(projectPath, { extraEnv, onProgress, targets })
    }
    report = await finalize(report)
    onProgress({
      phase: 'playwright',
      message: `치유 ${healed} · 회귀의심 ${realBugs} · 통과 ${report.passed}/실패 ${report.failed}`,
      done: true,
      error: realBugs > 0 || report.failed > 0
    })
    return { attempted, healed, realBugs, report, changes, notes }
  } catch (e) {
    const report = fatalReport((e as Error).message)
    await persist(projectPath, report).catch(() => {})
    onProgress({ phase: 'devserver', message: report.fatalError!, error: true, done: true })
    return { attempted: 0, healed: 0, realBugs: 0, report, changes: [], notes: [report.fatalError!] }
  } finally {
    server?.stop()
  }
}

/** 셀렉터 변경 위주의 간단한 라인 diff (바뀐 라인만, 최대 20줄) */
function lineDiff(before: string, after: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  const aSet = new Set(a)
  const bSet = new Set(b)
  const removed = a.filter((l) => l.trim() && !bSet.has(l)).map((l) => `- ${l.trim()}`)
  const added = b.filter((l) => l.trim() && !aSet.has(l)).map((l) => `+ ${l.trim()}`)
  return [...removed, ...added].slice(0, 20).join('\n')
}

// ----------------------------------------------------------------------------
// 헬퍼
// ----------------------------------------------------------------------------

/**
 * [negative-control] 통과하는 테스트의 기대값을 틀리게 변형 → 재실행.
 * 빨간불 = 진짜 검증(sensitive), 그래도 통과 = 알맹이 없음(vacuous). 끝나면 원본 복원.
 */
export async function negativeControl(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void,
  scope: TestScope = 'all'
): Promise<NegativeControlReport> {
  const inScope = (f: string): boolean =>
    scope === 'all' ? true : scope === 'code' ? f.startsWith('code-') : !f.startsWith('code-')
  let server: DevServerHandle | null = null
  try {
    server = await bootDevServer(projectPath, onProgress)
    await runSeedIfEnabled(projectPath, onProgress)
    const extraEnv = await qaEnv(projectPath)
    extraEnv.QA_BASE_URL = server.baseURL // dev 서버가 실제로 띄운 포트로 테스트
    // 로그인 URL 도 실제 서버 포트로 맞춤 (3000 점유 시 3001 등으로 떠도 로그인 성공)
    if (extraEnv.QA_LOGIN_URL) extraEnv.QA_LOGIN_URL = rewriteHost(extraEnv.QA_LOGIN_URL, server.baseURL)
    await writePlaywrightConfig(projectPath)

    onProgress({ phase: 'playwright', message: '기준 실행(통과 테스트 식별) 중…' })
    const baseline = await runPlaywright({ projectPath, onProgress, extraEnv })
    if (baseline.fatalError) return ncFail(baseline.fatalError)
    const passingFiles = [
      ...new Set(baseline.results.filter((r) => r.status === 'passed').map((r) => r.file))
    ].filter((f): f is string => !!f && inScope(f))

    const specs: SensitivitySpec[] = []
    for (const file of passingFiles.slice(0, 8)) {
      const specPath = resolveSpecPath(projectPath, file)
      if (!specPath) continue
      const before = await fs.readFile(specPath, 'utf8').catch(() => '')
      const { mutated, count } = mutateExpectations(before)
      if (count === 0) {
        specs.push({ spec: file, verdict: 'no-assertion', mutations: 0 })
        continue
      }
      onProgress({ phase: 'playwright', message: `변형 검증: ${file}` })
      await fs.writeFile(specPath, mutated, 'utf8')
      try {
        const r = await runPlaywright({ projectPath, onProgress, extraEnv, only: file })
        specs.push({ spec: file, verdict: r.failed > 0 ? 'sensitive' : 'vacuous', mutations: count })
      } finally {
        await fs.writeFile(specPath, before, 'utf8') // 원본 복원 (사이드이펙트 0)
      }
    }

    const sensitive = specs.filter((s) => s.verdict === 'sensitive').length
    const vacuous = specs.filter((s) => s.verdict === 'vacuous').length
    // 알맹이 없는 것 먼저
    const ord: Record<SensitivitySpec['verdict'], number> = { vacuous: 0, 'no-assertion': 1, sensitive: 2 }
    specs.sort((a, b) => ord[a.verdict] - ord[b.verdict])
    onProgress({
      phase: 'playwright',
      message: `검증 ${specs.length} · 진짜 ${sensitive} · 알맹이없음 ${vacuous}`,
      done: true,
      error: vacuous > 0
    })
    return { tested: specs.length, sensitive, vacuous, specs }
  } catch (e) {
    return ncFail((e as Error).message)
  } finally {
    server?.stop()
  }
}

function ncFail(msg: string): NegativeControlReport {
  return { tested: 0, sensitive: 0, vacuous: 0, specs: [], fatalError: msg }
}

/** 강한 단언의 '기대값'을 명백히 틀린 값으로 변형 (진짜 테스트면 빨간불) */
function mutateExpectations(src: string): { mutated: string; count: number } {
  let count = 0
  let out = src
  out = out.replace(
    /\.(toHaveText|toContainText|toHaveValue|toHaveTitle|toHaveAttribute)\(\s*(['"`])(?:(?!\2).)*\2/g,
    (_m, fn, q) => {
      count++
      return `.${fn}(${q}__QA_MUTANT_${count}__${q}`
    }
  )
  out = out.replace(/\.toHaveURL\(\s*(['"`])(?:(?!\1).)*\1/g, (_m, q) => {
    count++
    return `.toHaveURL(${q}/__qa_mutant_no_match__${q}`
  })
  out = out.replace(/\.toHaveURL\(\s*\/(?:[^/\\]|\\.)*\//g, () => {
    count++
    return `.toHaveURL(/__qa_mutant_no_match_xyz__/`
  })
  out = out.replace(/\.toHaveCount\(\s*(\d+)\s*\)/g, (_m, n) => {
    count++
    return `.toHaveCount(${parseInt(n, 10) + 99999})`
  })
  return { mutated: out, count }
}

/** opt-in 시드 명령 실행 (config.seed.enabled 일 때만). 파괴적이므로 사용자가 명시 활성화해야 함. */
async function runSeedIfEnabled(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<void> {
  const config = await getConfig(projectPath)
  const cmd = config.seed?.enabled ? config.seed.setupCommand?.trim() : ''
  if (!cmd) return
  onProgress({ phase: 'devserver', message: `시드 실행: ${cmd}` })
  await new Promise<void>((resolve) => {
    const c = spawn(cmd, {
      cwd: projectPath,
      shell: true,
      // 시드 스크립트가 DATABASE_URL 등을 쓰므로 프로젝트 .env 를 주입한다.
      env: { ...process.env, ...loadProjectEnv(projectPath) },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const onData = (d: Buffer): void =>
      onProgress({ phase: 'devserver', message: '시드…', log: d.toString().trimEnd() })
    c.stdout?.on('data', onData)
    c.stderr?.on('data', onData)
    c.on('close', () => resolve())
    c.on('error', () => resolve())
  })
}

async function bootDevServer(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<DevServerHandle> {
  const config = await getConfig(projectPath)
  return startDevServer({
    projectPath,
    devCommand: config.devCommand,
    readyUrl: config.readyUrl,
    readyTimeoutMs: config.readyTimeoutMs,
    onProgress
  })
}

async function runAndStamp(
  projectPath: string,
  opts: {
    extraEnv: Record<string, string>
    onProgress: (e: ProgressEvent) => void
    only?: string
    targets?: string[]
    signal?: AbortSignal
  }
): Promise<RunReport> {
  // 실행 전 config 를 최신 템플릿으로 보장 (구버전/손상 방지)
  await writePlaywrightConfig(projectPath)
  const report = await runPlaywright({
    projectPath,
    onProgress: opts.onProgress,
    extraEnv: opts.extraEnv,
    only: opts.only,
    targets: opts.targets,
    signal: opts.signal
  })
  // 중단된 경우 Playwright 의 저수준 abort 메시지를 사람 친화적으로 교체
  if (opts.signal?.aborted) {
    report.fatalError = '사용자가 실행을 중단했습니다.'
  }
  return { ...report, startedAt: report.startedAt || new Date().toISOString() }
}

/** playwright 실행에 주입할 QA_* 환경변수 (config + auth) */
async function qaEnv(projectPath: string): Promise<Record<string, string>> {
  const config = await getConfig(projectPath)
  const env = await authEnv(projectPath)
  env.QA_BASE_URL = config.baseURL
  env.QA_AUTH_ENABLED = config.auth?.enabled ? '1' : '0'
  env.QA_MAX_FAILURES = String(config.maxFailures ?? 0)
  return env
}

function groupFailingFiles(results: TestResult[]): Map<string, TestResult[]> {
  const map = new Map<string, TestResult[]>()
  for (const r of results) {
    if (r.status !== 'failed' && r.status !== 'timedOut') continue
    const key = r.file ?? '(unknown)'
    const arr = map.get(key) ?? []
    arr.push(r)
    map.set(key, arr)
  }
  return map
}

/** Playwright 가 보고한 file(상대경로 추정)을 절대경로로 해석 */
function resolveSpecPath(projectPath: string, file: string): string | null {
  if (!file || file === '(unknown)') return null
  const candidates = [
    isAbsolute(file) ? file : '',
    join(qaDir(projectPath), file), // rootDir(.qa) 기준
    join(projectPath, file),
    join(testsDir(projectPath), file.replace(/^tests[/\\]/, ''))
  ].filter(Boolean)
  return candidates.find((c) => existsSync(c)) ?? null
}

function announce(report: RunReport, onProgress: (e: ProgressEvent) => void): void {
  onProgress({
    phase: 'playwright',
    message: report.fatalError
      ? `실행 실패: ${report.fatalError}`
      : `완료 — 통과 ${report.passed} / 실패 ${report.failed} / 스킵 ${report.skipped}`,
    done: true,
    error: Boolean(report.fatalError) || report.failed > 0
  })
}

/** 부분 실행 결과(partial)를 이전 전체 리포트(prev)에 덮어 병합. 안 돌린 결과는 보존. */
export function mergeReports(prev: RunReport, partial: RunReport): RunReport {
  const key = (r: TestResult): string => `${r.file ?? ''}::${r.title}`
  const updated = new Map(partial.results.map((r) => [key(r), r]))
  const prevKeys = new Set(prev.results.map(key))
  const results = prev.results.map((r) => updated.get(key(r)) ?? r)
  // 이전에 없던(새로 생긴) 결과는 추가
  for (const r of partial.results) if (!prevKeys.has(key(r))) results.push(r)
  return {
    startedAt: partial.startedAt || prev.startedAt,
    durationMs: partial.durationMs,
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed' || r.status === 'timedOut').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results
  }
}

function fatalReport(message: string): RunReport {
  return {
    startedAt: new Date().toISOString(),
    durationMs: 0,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    results: [],
    fatalError: message
  }
}

function trim(s?: string): string {
  return (s ?? '').replace(/\s+/g, ' ').slice(0, 300)
}
function firstLine(s: string): string {
  return s.split('\n')[0]?.slice(0, 200) ?? ''
}

async function persist(projectPath: string, report: RunReport): Promise<void> {
  await fs.writeFile(lastReportPath(projectPath), JSON.stringify(report, null, 2), 'utf8')
}

export async function getLastReport(projectPath: string): Promise<RunReport | null> {
  try {
    return JSON.parse(await fs.readFile(lastReportPath(projectPath), 'utf8'))
  } catch {
    return null
  }
}
