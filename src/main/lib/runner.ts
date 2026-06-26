import { promises as fs } from 'node:fs'
import type { ProgressEvent, RunReport } from '@shared/types'
import { getConfig, lastReportPath } from './projectManager'
import { startDevServer } from './devServer'
import { runPlaywright } from './playwrightRunner'

/** [결정적] dev 서버 구동 → Playwright 실행 → 리포트 저장. AI 미사용. */
export async function runTests(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<RunReport> {
  const config = await getConfig(projectPath)
  let server: { stop: () => void } | null = null

  try {
    server = await startDevServer({
      projectPath,
      devCommand: config.devCommand,
      readyUrl: config.readyUrl,
      readyTimeoutMs: config.readyTimeoutMs,
      onProgress
    })

    const report = await runPlaywright({ projectPath, onProgress })
    const stamped: RunReport = {
      ...report,
      startedAt: report.startedAt || new Date().toISOString()
    }
    await persist(projectPath, stamped)
    onProgress({
      phase: 'playwright',
      message: stamped.fatalError
        ? `실행 실패: ${stamped.fatalError}`
        : `완료 — 통과 ${stamped.passed} / 실패 ${stamped.failed} / 스킵 ${stamped.skipped}`,
      done: true,
      error: Boolean(stamped.fatalError) || stamped.failed > 0
    })
    return stamped
  } catch (e) {
    const report: RunReport = {
      startedAt: new Date().toISOString(),
      durationMs: 0,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      results: [],
      fatalError: (e as Error).message
    }
    await persist(projectPath, report).catch(() => {})
    onProgress({ phase: 'devserver', message: report.fatalError!, error: true, done: true })
    return report
  } finally {
    server?.stop()
  }
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
