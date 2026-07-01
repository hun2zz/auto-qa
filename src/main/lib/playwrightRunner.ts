import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join, resolve as resolvePath } from 'node:path'
import type {
  FlakyReport,
  FlakyTest,
  ProgressEvent,
  RunReport,
  TestResult,
  TestStatus
} from '@shared/types'

/**
 * 타겟 프로젝트에서 Playwright 를 실행하고 JSON 리포트를 RunReport 로 변환.
 *
 * 타겟 프로젝트에 @playwright/test 가 없어도 동작하도록, auto-qa 가 자체 보유한
 * playwright 를 쓰고 NODE_PATH 로 모듈 해석 경로를 잡아준다(타겟 프로젝트 미오염).
 * 브라우저가 없으면 자동 설치 후 1회 재시도한다.
 */
export async function runPlaywright(args: {
  projectPath: string
  onProgress: (e: ProgressEvent) => void
  signal?: AbortSignal
  /** auth 등 추가 환경변수 (비밀번호 주입) */
  extraEnv?: Record<string, string>
  /** 특정 spec 파일만 재실행 (self-healing 용). .qa 기준 또는 파일명 */
  only?: string
  /** 여러 타깃(파일 또는 file:line) 재실행. only 보다 우선. */
  targets?: string[]
}): Promise<RunReport> {
  const { projectPath, onProgress, signal, extraEnv, only, targets } = args
  const tool = toolPaths(projectPath)
  const env = buildEnv(tool, extraEnv)

  onProgress({
    phase: 'playwright',
    message: only ? `재실행: ${only}` : 'Playwright 실행 중…',
    log: `playwright: ${tool.source}`
  })

  const testArgs = ['test', '--config', join('.qa', 'playwright.config.ts'), '--reporter=json']
  // 타깃 필터: targets(여러 개) 우선, 없으면 only(단일). Playwright 는 위치 인자를
  // 파일 경로 부분일치 + :line 필터로 받는다.
  const filters = targets && targets.length ? targets : only ? [only] : []
  for (const f of filters) testArgs.push(f)

  const res = await execWithBrowserRetry(tool, testArgs, { projectPath, env, signal, onProgress })
  if (res.spawnError) return fatal(`Playwright 실행 실패: ${res.spawnError}`)
  const json = extractJson(res.stdout)
  if (!json) return fatal(res.stderr.slice(-3000) || 'Playwright JSON 리포트를 파싱하지 못했습니다.')
  try {
    return toReport(json)
  } catch (e) {
    return fatal(`리포트 변환 실패: ${(e as Error).message}`)
  }
}

/**
 * [Flaky 감지] 대상 테스트를 --repeat-each N (재시도 0)로 실행하고, 반복 결과가
 * '섞인'(통과+실패 공존) 테스트를 색출한다. retries=0 이라 각 반복은 단일 시도 → 진짜 불안정만 잡힘.
 */
export async function detectFlakyPlaywright(args: {
  projectPath: string
  onProgress: (e: ProgressEvent) => void
  repeat: number
  signal?: AbortSignal
  extraEnv?: Record<string, string>
  /** 대상 필터(파일/트랙). 비면 전체 */
  filters?: string[]
}): Promise<FlakyReport> {
  const { projectPath, onProgress, signal, extraEnv, repeat, filters } = args
  const tool = toolPaths(projectPath)
  const env = buildEnv(tool, extraEnv)

  const testArgs = [
    'test',
    '--config',
    join('.qa', 'playwright.config.ts'),
    '--reporter=json',
    `--repeat-each=${repeat}`,
    '--retries=0'
  ]
  for (const f of filters ?? []) testArgs.push(f)

  onProgress({ phase: 'playwright', message: `Flaky 감지: 각 테스트 ${repeat}회 반복 실행 중…` })
  const res = await execWithBrowserRetry(tool, testArgs, { projectPath, env, signal, onProgress })
  if (res.spawnError) return flakyFatal(`Playwright 실행 실패: ${res.spawnError}`)
  const json = extractJson(res.stdout)
  if (!json) return flakyFatal(res.stderr.slice(-3000) || 'Playwright JSON 리포트를 파싱하지 못했습니다.')
  try {
    return parseFlaky(json, repeat)
  } catch (e) {
    return flakyFatal(`리포트 변환 실패: ${(e as Error).message}`)
  }
}

/** 실행 env 구성 (번들 playwright 일 때만 NODE_PATH 주입 — 타겟 자체 설치본은 미주입). */
function buildEnv(tool: ToolPaths, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv, FORCE_COLOR: '0' }
  if (tool.injectNodePath) {
    env.NODE_PATH = tool.nodeModules + (process.env.NODE_PATH ? delimiter + process.env.NODE_PATH : '')
  }
  return env
}

/** playwright 실행 + 브라우저 미설치 시 자동 설치 후 1회 재시도. */
async function execWithBrowserRetry(
  tool: ToolPaths,
  testArgs: string[],
  opts: { projectPath: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; onProgress: (e: ProgressEvent) => void }
): Promise<PwResult> {
  let res = await spawnPw(tool, testArgs, opts)
  if (needsBrowserInstall(res.stdout + res.stderr)) {
    opts.onProgress({ phase: 'playwright', message: 'Playwright 브라우저 설치 중… (최초 1회)' })
    await spawnPw(tool, ['install', 'chromium'], opts)
    opts.onProgress({ phase: 'playwright', message: '브라우저 설치 완료, 재실행…' })
    res = await spawnPw(tool, testArgs, opts)
  }
  return res
}

interface ToolPaths {
  cmd: string
  prefix: string[]
  nodeModules: string
  shell: boolean
  /** 번들 playwright 사용 시에만 NODE_PATH 주입 (타겟 자체 설치본은 주입 금지) */
  injectNodePath: boolean
  /** 진단용 라벨 */
  source: string
}

const PW_BIN = process.platform === 'win32' ? 'playwright.cmd' : 'playwright'

/**
 * 실행에 쓸 playwright 바이너리 결정.
 * 핵심 불변식: 러너 바이너리와 spec 의 @playwright/test import 는 같은 설치본이어야 한다.
 *  1) 타겟이 자체 @playwright/test + 바이너리를 가지면 → 타겟 것을 쓴다(버전 일치 보장, NODE_PATH 미주입)
 *  2) 아니면 → auto-qa 번들 바이너리 + NODE_PATH=auto-qa/node_modules
 *  3) 둘 다 없으면 → npx fallback(번들 취급)
 */
function toolPaths(projectPath: string): ToolPaths {
  const win = process.platform === 'win32'

  // 1) 타겟 자체 설치본
  const targetNm = join(projectPath, 'node_modules')
  const targetBin = join(targetNm, '.bin', PW_BIN)
  const targetPkg = join(targetNm, '@playwright', 'test', 'package.json')
  if (existsSync(targetBin) && existsSync(targetPkg)) {
    return { cmd: targetBin, prefix: [], nodeModules: targetNm, shell: win, injectNodePath: false, source: '타겟 자체 설치본' }
  }

  // 2) auto-qa 번들 (번들된 main 은 out/main 에 위치 → ../.. 가 auto-qa 루트)
  const appRoot = resolvePath(import.meta.dirname, '..', '..')
  const nodeModules = join(appRoot, 'node_modules')
  const bin = join(nodeModules, '.bin', PW_BIN)
  if (existsSync(bin)) {
    return { cmd: bin, prefix: [], nodeModules, shell: win, injectNodePath: true, source: 'auto-qa 번들' }
  }

  // 3) fallback: npx 로 즉석 설치 (번들 취급 → NODE_PATH 주입)
  return { cmd: 'npx', prefix: ['--yes', 'playwright'], nodeModules, shell: win, injectNodePath: true, source: 'npx fallback' }
}

interface PwResult {
  stdout: string
  stderr: string
  spawnError?: string
}

function spawnPw(
  tool: ToolPaths,
  pwArgs: string[],
  opts: {
    projectPath: string
    env: NodeJS.ProcessEnv
    signal?: AbortSignal
    onProgress: (e: ProgressEvent) => void
  }
): Promise<PwResult> {
  return new Promise((resolve) => {
    const child = spawn(tool.cmd, [...tool.prefix, ...pwArgs], {
      cwd: opts.projectPath,
      shell: tool.shell,
      env: opts.env,
      signal: opts.signal
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      stdout += d
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-4000)
      opts.onProgress({ phase: 'playwright', message: '실행 중…', log: d.trimEnd() })
    })
    child.on('error', (err) => resolve({ stdout, stderr, spawnError: err.message }))
    child.on('close', () => resolve({ stdout, stderr }))
  })
}

function needsBrowserInstall(output: string): boolean {
  return /Executable doesn't exist|playwright install|Looks like Playwright was just installed/i.test(
    output
  )
}

function fatal(msg: string): RunReport {
  return {
    startedAt: '',
    durationMs: 0,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    results: [],
    fatalError: msg
  }
}

/** stdout 에 로그가 섞여 있어도 첫 '{' 부터 끝까지를 JSON 으로 시도 */
function extractJson(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf('{')
  if (start === -1) return null
  for (let end = stdout.length; end > start; end--) {
    if (stdout[end - 1] !== '}') continue
    try {
      return JSON.parse(stdout.slice(start, end))
    } catch {
      /* 계속 줄여가며 시도 */
    }
  }
  return null
}

interface PwSpec {
  title: string
  line?: number
  tests?: Array<{ results?: Array<{ status?: string; duration?: number; error?: { message?: string } }> }>
}
interface PwSuite {
  file?: string
  specs?: PwSpec[]
  suites?: PwSuite[]
}

function toReport(json: Record<string, unknown>): RunReport {
  const results: TestResult[] = []
  const walk = (suite: PwSuite, file?: string): void => {
    const f = suite.file ?? file
    for (const spec of suite.specs ?? []) {
      const r = spec.tests?.[0]?.results?.[0]
      const status = normalizeStatus(r?.status)
      results.push({
        title: spec.title,
        status,
        durationMs: r?.duration ?? 0,
        error: r?.error?.message,
        file: f,
        line: spec.line
      })
    }
    for (const child of suite.suites ?? []) walk(child, f)
  }
  for (const s of (json.suites as PwSuite[]) ?? []) walk(s)

  const stats = (json.stats as { duration?: number; startTime?: string }) ?? {}
  return {
    startedAt: stats.startTime ?? '',
    durationMs: Math.round(stats.duration ?? 0),
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed' || r.status === 'timedOut').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results
  }
}

function flakyFatal(msg: string): FlakyReport {
  return { repeat: 0, tested: 0, flaky: [], stable: 0, failing: 0, fatalError: msg }
}

/**
 * repeat-each 결과에서 flaky(통과+실패 공존)를 색출.
 * ⚠️ Playwright 의 --repeat-each 는 '같은 테스트'를 별도 spec 항목으로 N번 중복 등장시킨다
 *   (한 spec 안에 N개 results 가 아님). 그래서 file+title+line 으로 묶어 N회를 합산해야
 *   flaky 판정이 된다. (안 묶으면 각 항목이 결과 1개뿐이라 절대 '섞임'이 안 나옴)
 */
function parseFlaky(json: Record<string, unknown>, repeat: number): FlakyReport {
  interface Agg {
    file?: string
    title: string
    line?: number
    passed: number
    failed: number
  }
  const groups = new Map<string, Agg>()

  const walk = (suite: PwSuite, file?: string): void => {
    const f = suite.file ?? file
    for (const spec of suite.specs ?? []) {
      const key = `${f ?? ''}::${spec.title}::${spec.line ?? ''}`
      const g = groups.get(key) ?? { file: f, title: spec.title, line: spec.line, passed: 0, failed: 0 }
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          const st = normalizeStatus(r.status)
          if (st === 'passed') g.passed++
          else if (st === 'skipped') {
            /* skip 은 실행 횟수에서 제외 */
          } else g.failed++ // failed | timedOut
        }
      }
      groups.set(key, g)
    }
    for (const child of suite.suites ?? []) walk(child, f)
  }
  for (const s of (json.suites as PwSuite[]) ?? []) walk(s)

  const flaky: FlakyTest[] = []
  let stable = 0
  let failing = 0
  let tested = 0
  for (const g of groups.values()) {
    const runs = g.passed + g.failed
    if (runs === 0) continue // 전부 skip → 평가 대상 아님
    tested++
    if (g.passed > 0 && g.failed > 0) {
      flaky.push({ title: g.title, file: g.file, line: g.line, passed: g.passed, failed: g.failed, runs })
    } else if (g.failed === runs) {
      failing++ // 매번 실패 = 진짜 실패(불안정 아님)
    } else {
      stable++ // 매번 통과
    }
  }
  // 불안정 심한 순(실패 비율 높은 순)
  flaky.sort((a, b) => b.failed / b.runs - a.failed / a.runs)
  return { repeat, tested, flaky, stable, failing }
}

function normalizeStatus(s?: string): TestStatus {
  switch (s) {
    case 'passed':
      return 'passed'
    case 'timedOut':
      return 'timedOut'
    case 'skipped':
    case 'interrupted':
      return 'skipped'
    default:
      return 'failed'
  }
}
