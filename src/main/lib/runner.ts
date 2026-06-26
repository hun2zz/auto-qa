import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { HealResult, ProgressEvent, RunReport, TestResult } from '@shared/types'
import { getConfig, lastReportPath, qaDir, testsDir } from './projectManager'
import { startDevServer, type DevServerHandle } from './devServer'
import { runPlaywright } from './playwrightRunner'
import { runClaude } from './claudeRunner'
import { authEnv } from './auth'
import { healPrompt } from './prompts'

/** [결정적] dev 서버 구동 → Playwright 실행 → 리포트 저장. AI 미사용. */
export async function runTests(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<RunReport> {
  let server: DevServerHandle | null = null
  try {
    server = await bootDevServer(projectPath, onProgress)
    const extraEnv = await authEnv(projectPath)
    const stamped = await runAndStamp(projectPath, { extraEnv, onProgress })
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
    const extraEnv = await authEnv(projectPath)

    // 1차 실행
    let report = await runAndStamp(projectPath, { extraEnv, onProgress })
    const failedFiles = groupFailingFiles(report.results)

    if (failedFiles.size === 0) {
      await persist(projectPath, report)
      return { attempted: 0, healed: 0, report, notes: ['실패한 테스트가 없습니다.'] }
    }

    // 2. 실패 spec 별로 AI 치유 (최대 5개 파일)
    let attempted = 0
    let healed = 0
    for (const [file, failures] of [...failedFiles].slice(0, 5)) {
      const specPath = resolveSpecPath(projectPath, file)
      if (!specPath) {
        notes.push(`SKIP: spec 경로를 찾지 못함 (${file})`)
        continue
      }
      attempted++
      onProgress({ phase: 'tests', message: `AI 자동 수정 중: ${file}` })
      const res = await runClaude({
        projectPath,
        prompt: healPrompt({
          specPath,
          storageStateRel: null,
          failures: failures.map((f) => `- ${f.title}: ${trim(f.error)}`).join('\n')
        }),
        allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
        phase: 'tests',
        onProgress
      })
      const summary = (res.summary || '').trim()
      notes.push(`${file} → ${firstLine(summary) || (res.ok ? '처리됨' : res.error || '실패')}`)
      if (res.ok && /^HEALED/i.test(summary)) healed++
    }

    // 3. 치유가 있었으면 재실행
    if (healed > 0) {
      onProgress({ phase: 'playwright', message: '수정본 재실행 중…' })
      report = await runAndStamp(projectPath, { extraEnv, onProgress })
    }
    await persist(projectPath, report)
    announce(report, onProgress)
    return { attempted, healed, report, notes }
  } catch (e) {
    const report = fatalReport((e as Error).message)
    await persist(projectPath, report).catch(() => {})
    onProgress({ phase: 'devserver', message: report.fatalError!, error: true, done: true })
    return { attempted: 0, healed: 0, report, notes: [report.fatalError!] }
  } finally {
    server?.stop()
  }
}

// ----------------------------------------------------------------------------
// 헬퍼
// ----------------------------------------------------------------------------

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
  opts: { extraEnv: Record<string, string>; onProgress: (e: ProgressEvent) => void }
): Promise<RunReport> {
  const report = await runPlaywright({
    projectPath,
    onProgress: opts.onProgress,
    extraEnv: opts.extraEnv
  })
  return { ...report, startedAt: report.startedAt || new Date().toISOString() }
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
