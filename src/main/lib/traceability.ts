import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type {
  Checklist,
  RunReport,
  TraceabilityReport,
  TraceRow,
  TraceState
} from '@shared/types'
import { lastReportPath, listChecklists, listRequirements, testsDir } from './projectManager'
import { getCodeCoverage } from './codeCoverage'

/** 마지막 실행 리포트를 읽는다(없으면 null). */
async function readLastReport(projectPath: string): Promise<RunReport | null> {
  try {
    return JSON.parse(await fs.readFile(lastReportPath(projectPath), 'utf8'))
  } catch {
    return null
  }
}

type RunAgg = { passed: number; failed: number; skipped: number; total: number }

/** spec 파일명(basename) → 실행 결과 집계. auth.setup 등도 그대로 담되, 소비 측에서 무시. */
function runBySpec(report: RunReport | null): Map<string, RunAgg> {
  const m = new Map<string, RunAgg>()
  for (const r of report?.results ?? []) {
    const f = r.file ? basename(r.file) : null
    if (!f) continue
    const a = m.get(f) ?? { passed: 0, failed: 0, skipped: 0, total: 0 }
    a.total++
    if (r.status === 'passed') a.passed++
    else if (r.status === 'skipped') a.skipped++
    else a.failed++ // failed | timedOut
    m.set(f, a)
  }
  return m
}

/** 테스트(spec)가 붙은 행의 상태를 실행 결과로 판정. */
function stateFromRun(run: RunAgg | null): TraceState {
  if (!run || run.total === 0) return 'not-run'
  if (run.failed > 0) return 'failing'
  if (run.passed > 0) return 'verified'
  return 'not-run' // 전부 skip
}

/** 체크리스트 한 개 → scope 행. */
function scopeRow(c: Checklist, runMap: Map<string, RunAgg>): TraceRow {
  const specFile = c.specPath ? basename(c.specPath) : null
  const run = specFile ? (runMap.get(specFile) ?? null) : null
  let state: TraceState
  if (specFile) state = stateFromRun(run)
  else state = c.status === 'approved' ? 'no-test' : 'draft'
  return {
    track: 'scope',
    requirement: c.sourceRequirement || null,
    title: c.title,
    checklistId: c.id,
    checklistStatus: c.status,
    specFile,
    sourceStale: c.sourceStale,
    specStale: c.specStale,
    run,
    state
  }
}

/**
 * 추적성 리포트: 요구사항 → 체크리스트 → 테스트 → 실행을 조인.
 * 새로 수집하지 않고 기존 .qa 산출물만 읽어 결정적으로 만든다(AI 미사용).
 */
export async function getTraceability(projectPath: string): Promise<TraceabilityReport> {
  const [checklists, requirements, report, coverage] = await Promise.all([
    listChecklists(projectPath),
    listRequirements(projectPath),
    readLastReport(projectPath),
    getCodeCoverage(projectPath)
  ])
  const runMap = runBySpec(report)
  const rows: TraceRow[] = []

  // ① 체크리스트 단위 scope 행
  for (const c of checklists) rows.push(scopeRow(c, runMap))

  // ② 체크리스트가 없는 '고아 요구사항' → no-checklist 행
  const referredReq = new Set(checklists.map((c) => c.sourceRequirement).filter(Boolean))
  for (const r of requirements) {
    if (referredReq.has(r.name)) continue
    rows.push({
      track: 'scope',
      requirement: r.name,
      title: r.name,
      checklistId: null,
      checklistStatus: null,
      specFile: null,
      run: null,
      state: 'no-checklist'
    })
  }

  // ③ 요구사항 링크가 없는 code-*.spec (체크리스트가 참조 안 함) → code 행
  const linkedSpecs = new Set(
    checklists.map((c) => (c.specPath ? basename(c.specPath) : null)).filter(Boolean) as string[]
  )
  const dir = testsDir(projectPath)
  const specFiles = existsSync(dir)
    ? (await fs.readdir(dir)).filter((f) => f.endsWith('.spec.ts'))
    : []
  for (const f of specFiles.sort()) {
    if (linkedSpecs.has(f)) continue // 이미 scope 행으로 표시됨
    const run = runMap.get(f) ?? null
    rows.push({
      track: 'code',
      requirement: null,
      title: f,
      checklistId: null,
      checklistStatus: null,
      specFile: f,
      run,
      state: stateFromRun(run)
    })
  }

  // ── 요약 ──
  const scopeRows = rows.filter((r) => r.track === 'scope')
  const verified = rows.filter((r) => r.state === 'verified').length
  const failing = rows.filter((r) => r.state === 'failing').length
  const gaps = rows.filter((r) => r.state === 'no-test' || r.state === 'no-checklist').length
  const scopeVerified = scopeRows.filter((r) => r.state === 'verified').length

  return {
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      requirements: requirements.length,
      checklists: checklists.length,
      specs: specFiles.length,
      verified,
      failing,
      gaps,
      verifiedPct: scopeRows.length ? Math.round((scopeVerified / scopeRows.length) * 1000) / 10 : 0
    },
    codeCoveragePct: coverage?.lines?.pct,
    lastRunAt: report?.startedAt
  }
}
