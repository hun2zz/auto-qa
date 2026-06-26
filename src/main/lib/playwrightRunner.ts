import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { ProgressEvent, RunReport, TestResult, TestStatus } from '@shared/types'

/**
 * 타겟 프로젝트에서 Playwright 를 실행하고 JSON 리포트를 RunReport 로 변환.
 * reporter=json 을 stdout 으로 받아 파싱(파일 경로 의존 제거).
 */
export async function runPlaywright(args: {
  projectPath: string
  onProgress: (e: ProgressEvent) => void
  signal?: AbortSignal
}): Promise<RunReport> {
  const { projectPath, onProgress, signal } = args
  const configPath = join('.qa', 'playwright.config.ts')

  onProgress({ phase: 'playwright', message: 'Playwright 실행 중…' })

  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['--yes', 'playwright', 'test', '--config', configPath, '--reporter=json'],
      {
        cwd: projectPath,
        shell: process.platform === 'win32',
        env: { ...process.env, FORCE_COLOR: '0' },
        signal
      }
    )

    let stdout = ''
    let stderrTail = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      stdout += d
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d: string) => {
      stderrTail = (stderrTail + d).slice(-3000)
      onProgress({ phase: 'playwright', message: '실행 중…', log: d.trimEnd() })
    })

    child.on('error', (err) => {
      resolve(fatal(`Playwright 실행 실패: ${err.message}`))
    })

    child.on('close', () => {
      const json = extractJson(stdout)
      if (!json) {
        resolve(fatal(stderrTail || 'Playwright JSON 리포트를 파싱하지 못했습니다.'))
        return
      }
      try {
        resolve(toReport(json))
      } catch (e) {
        resolve(fatal(`리포트 변환 실패: ${(e as Error).message}`))
      }
    })
  })
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
  specs?: PwSpec[]
  suites?: PwSuite[]
}

function toReport(json: Record<string, unknown>): RunReport {
  const results: TestResult[] = []
  const walk = (suite: PwSuite): void => {
    for (const spec of suite.specs ?? []) {
      const r = spec.tests?.[0]?.results?.[0]
      const status = normalizeStatus(r?.status)
      results.push({
        title: spec.title,
        status,
        durationMs: r?.duration ?? 0,
        error: r?.error?.message
      })
    }
    for (const child of suite.suites ?? []) walk(child)
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
