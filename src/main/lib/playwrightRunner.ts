import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join, resolve as resolvePath } from 'node:path'
import type { ProgressEvent, RunReport, TestResult, TestStatus } from '@shared/types'

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
  const configPath = join('.qa', 'playwright.config.ts')
  const tool = toolPaths(projectPath)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    FORCE_COLOR: '0'
  }
  // 번들 playwright 를 쓸 때만 NODE_PATH 로 모듈 해석을 보강한다.
  // 타겟이 자체 @playwright/test 를 가지면, 러너 바이너리와 spec 의 import 가
  // 반드시 같은 설치본을 가리켜야 한다(서로 다르면 테스트 등록 레지스트리가 갈려
  // "No tests found" 가 난다). 그래서 이때는 NODE_PATH 를 주입하지 않는다.
  if (tool.injectNodePath) {
    env.NODE_PATH = tool.nodeModules + (process.env.NODE_PATH ? delimiter + process.env.NODE_PATH : '')
  }

  onProgress({
    phase: 'playwright',
    message: only ? `재실행: ${only}` : 'Playwright 실행 중…',
    log: `playwright: ${tool.source}`
  })

  const testArgs = ['test', '--config', configPath, '--reporter=json']
  // 타깃 필터: targets(여러 개) 우선, 없으면 only(단일). Playwright 는 위치 인자를
  // 파일 경로 부분일치 + :line 필터로 받는다.
  const filters = targets && targets.length ? targets : only ? [only] : []
  for (const f of filters) testArgs.push(f)

  let res = await spawnPw(tool, testArgs, { projectPath, env, signal, onProgress })

  // 브라우저 미설치 → 자동 설치 후 1회 재시도
  if (needsBrowserInstall(res.stdout + res.stderr)) {
    onProgress({ phase: 'playwright', message: 'Playwright 브라우저 설치 중… (최초 1회)' })
    await spawnPw(tool, ['install', 'chromium'], { projectPath, env, signal, onProgress })
    onProgress({ phase: 'playwright', message: '브라우저 설치 완료, 재실행…' })
    res = await spawnPw(tool, testArgs, { projectPath, env, signal, onProgress })
  }

  if (res.spawnError) return fatal(`Playwright 실행 실패: ${res.spawnError}`)
  const json = extractJson(res.stdout)
  if (!json) return fatal(res.stderr.slice(-3000) || 'Playwright JSON 리포트를 파싱하지 못했습니다.')
  try {
    return toReport(json)
  } catch (e) {
    return fatal(`리포트 변환 실패: ${(e as Error).message}`)
  }
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
