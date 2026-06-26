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
}): Promise<RunReport> {
  const { projectPath, onProgress, signal, extraEnv, only } = args
  const configPath = join('.qa', 'playwright.config.ts')
  const tool = toolPaths()

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    FORCE_COLOR: '0',
    // 타겟 프로젝트가 @playwright/test 를 못 찾을 때 auto-qa 의 것을 fallback 으로
    NODE_PATH: tool.nodeModules + (process.env.NODE_PATH ? delimiter + process.env.NODE_PATH : '')
  }

  onProgress({ phase: 'playwright', message: only ? `재실행: ${only}` : 'Playwright 실행 중…' })

  const testArgs = ['test', '--config', configPath, '--reporter=json']
  if (only) testArgs.push(only)

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
}

/** auto-qa 가 자체 보유한 playwright 바이너리 경로 (없으면 npx fallback) */
function toolPaths(): ToolPaths {
  // 번들된 main 은 out/main 에 위치 → ../.. 가 auto-qa 루트
  const appRoot = resolvePath(import.meta.dirname, '..', '..')
  const nodeModules = join(appRoot, 'node_modules')
  const bin = join(nodeModules, '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright')
  if (existsSync(bin)) {
    return { cmd: bin, prefix: [], nodeModules, shell: process.platform === 'win32' }
  }
  // fallback: npx 로 즉석 설치
  return { cmd: 'npx', prefix: ['--yes', 'playwright'], nodeModules, shell: process.platform === 'win32' }
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
        file: f
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
