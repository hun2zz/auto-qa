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
  TestResult
} from '@shared/types'
import { getConfig, lastReportPath, qaDir, testsDir, writePlaywrightConfig } from './projectManager'
import { startDevServer, type DevServerHandle } from './devServer'
import { runPlaywright } from './playwrightRunner'
import { runClaude } from './claudeRunner'
import { authEnv } from './auth'
import { composeRules } from './rules'
import { healPrompt, rulesHeader } from './prompts'

/** [결정적] dev 서버 구동 → Playwright 실행 → 리포트 저장. AI 미사용. */
export async function runTests(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void,
  only?: string
): Promise<RunReport> {
  let server: DevServerHandle | null = null
  try {
    server = await bootDevServer(projectPath, onProgress)
    await runSeedIfEnabled(projectPath, onProgress)
    const extraEnv = await qaEnv(projectPath)
    const stamped = await runAndStamp(projectPath, { extraEnv, onProgress, only })
    await persist(projectPath, stamped)
    announce(stamped, onProgress)
    return stamped
  } catch (e) {
    const report = fatalReport((e as Error).message)
    await persist(projectPath, report).catch(() => {})
    onProgress({ phase: 'devserver', message: report.fatalError!, error: true, done: true })
    return report
  } finally {
    server?.stop()
  }
}

/**
 * [AI + 결정적] self-healing: 실행 → 실패한 spec 의 셀렉터를 AI 가 고침 → 재실행.
 * AI 는 '셀렉터 수정'만 하고 assertion 의도는 유지(거짓 통과 방지).
 */
export async function healAndRerun(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<HealResult> {
  let server: DevServerHandle | null = null
  const notes: string[] = []
  try {
    server = await bootDevServer(projectPath, onProgress)
    await runSeedIfEnabled(projectPath, onProgress)
    const extraEnv = await qaEnv(projectPath)

    // 1차 실행
    let report = await runAndStamp(projectPath, { extraEnv, onProgress })
    const failedFiles = groupFailingFiles(report.results)

    if (failedFiles.size === 0) {
      await persist(projectPath, report)
      return {
        attempted: 0,
        healed: 0,
        realBugs: 0,
        report,
        changes: [],
        notes: ['실패한 테스트가 없습니다.']
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
        allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
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
      report = await runAndStamp(projectPath, { extraEnv, onProgress })
    }
    await persist(projectPath, report)
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
  onProgress: (e: ProgressEvent) => void
): Promise<NegativeControlReport> {
  let server: DevServerHandle | null = null
  try {
    server = await bootDevServer(projectPath, onProgress)
    await runSeedIfEnabled(projectPath, onProgress)
    const extraEnv = await qaEnv(projectPath)
    await writePlaywrightConfig(projectPath)

    onProgress({ phase: 'playwright', message: '기준 실행(통과 테스트 식별) 중…' })
    const baseline = await runPlaywright({ projectPath, onProgress, extraEnv })
    if (baseline.fatalError) return ncFail(baseline.fatalError)
    const passingFiles = [
      ...new Set(baseline.results.filter((r) => r.status === 'passed').map((r) => r.file))
    ].filter((f): f is string => !!f)

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
    const c = spawn(cmd, { cwd: projectPath, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
  opts: { extraEnv: Record<string, string>; onProgress: (e: ProgressEvent) => void; only?: string }
): Promise<RunReport> {
  // 실행 전 config 를 최신 템플릿으로 보장 (구버전/손상 방지)
  await writePlaywrightConfig(projectPath)
  const report = await runPlaywright({
    projectPath,
    onProgress: opts.onProgress,
    extraEnv: opts.extraEnv,
    only: opts.only
  })
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
