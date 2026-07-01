import { useState, type JSX } from 'react'
import type { HealResult, RunReport, TestResult, TestStatus, TestScope } from '@shared/types'
import { useStore } from '../store'

const SCOPE_LABEL: Record<TestScope, string> = { all: '전체', scope: '개발범위', code: '코드' }
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge } from './common'
import { PlayIcon, AlertIcon, ChevronIcon, SparkleIcon } from './icons'

export function RunPanel(): JSX.Element {
  const lastReport = useStore((s) => s.lastReport)
  const runTests = useStore((s) => s.runTests)
  const runFailedTests = useStore((s) => s.runFailedTests)
  const cancelRun = useStore((s) => s.cancelRun)
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const checklists = useStore((s) => s.checklists)
  const testFiles = useStore((s) => s.testFiles)
  const setActiveStep = useStore((s) => s.setActiveStep)
  // 실제 .qa/tests 의 spec 이 하나라도 있으면 실행 가능 (코드 기준 테스트는 체크리스트가 없음)
  const hasSpecs = testFiles.length > 0 || checklists.some((c) => c.specPath)
  const scopeNames = testFiles.filter((f) => f.kind === 'checklist').map((f) => f.name)
  const codeNames = testFiles.filter((f) => f.kind === 'code').map((f) => f.name)
  const hasBothTracks = scopeNames.length > 0 && codeNames.length > 0

  const runBtn = (
    <div className="flex items-center gap-2">
      {hasBothTracks && !running && (
        <>
          <Button variant="secondary" title="개발범위 완료 테스트만 실행" onClick={() => void runTests(scopeNames)}>
            개발범위만
          </Button>
          <Button variant="secondary" title="코드 정밀 테스트만 실행" onClick={() => void runTests(codeNames)}>
            코드만
          </Button>
        </>
      )}
      <Button
        size="lg"
        variant="primary"
        icon={<PlayIcon />}
        loading={running}
        loadingText="실행 중…"
        disabled={!hasSpecs}
        title={hasSpecs ? undefined : '먼저 테스트를 생성하세요'}
        onClick={() => void runTests()}
      >
        {hasBothTracks ? '전체 실행' : 'QA 실행'}
      </Button>
      {running && (
        <Button size="lg" variant="secondary" onClick={() => void cancelRun()}>
          중단
        </Button>
      )}
    </div>
  )

  const failedCount = lastReport && !lastReport.fatalError ? lastReport.failed : 0
  const headerAction = (
    <div className="flex items-center gap-2">
      {failedCount > 0 && !running && (
        <Button variant="secondary" onClick={() => void runFailedTests()}>
          실패만 재실행 ({failedCount})
        </Button>
      )}
      {runBtn}
    </div>
  )

  return (
    <>
      <PanelHeader
        step={4}
        title="실행 & 리포트"
        desc="dev 서버를 구동하고 Playwright 테스트를 결정적으로 실행합니다."
        action={lastReport ? headerAction : undefined}
      />
      <PanelBody>
        {!lastReport ? (
          <EmptyState
            icon={<PlayIcon width={26} height={26} />}
            title="아직 실행 기록이 없습니다"
            desc={
              hasSpecs
                ? 'QA 실행을 누르면 dev 서버 구동 후 테스트가 자동으로 실행됩니다.'
                : '먼저 3단계에서 테스트 코드를 생성하세요.'
            }
            action={
              hasSpecs ? (
                runBtn
              ) : (
                <Button variant="secondary" onClick={() => setActiveStep('tests')}>
                  테스트 생성 단계로 이동 →
                </Button>
              )
            }
          />
        ) : (
          <ReportView report={lastReport} />
        )}
      </PanelBody>
    </>
  )
}

function NegativeControlBlock({ scope }: { scope: TestScope }): JSX.Element {
  const run = useStore((s) => s.runNegativeControl)
  const busy = useStore((s) => !!s.busyKeys['negativeControl'])
  const report = useStore((s) => s.negativeControl)
  const bad = report?.specs.filter((s) => s.verdict === 'vacuous') ?? []

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">
            기대값 변형 검증 (negative-control)
            <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-muted">
              대상: {SCOPE_LABEL[scope]}
            </span>
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            통과 테스트의 기대값을 일부러 틀리게 바꿔 재실행 → 빨간불이 떠야 '진짜 검증'.
            그래도 통과하면 알맹이 없는 테스트. (무거움 · 끝나면 원본 복원)
          </p>
        </div>
        <Button variant="secondary" loading={busy} loadingText="검증 중… (무거움)" onClick={() => void run(scope)}>
          변형 검증 실행
        </Button>
      </div>
      {report && !report.fatalError && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="ok">진짜 검증 {report.sensitive}</Badge>
            <Badge tone="bad">알맹이없음 {report.vacuous}</Badge>
            <Badge tone="muted">검사 {report.tested}</Badge>
          </div>
          {bad.length > 0 && (
            <ul className="mt-2 space-y-1">
              {bad.map((s, i) => (
                <li key={i} className="font-mono text-[11px] text-bad">
                  ✗ {s.spec} — 기대값 틀려도 통과 (검증 안 함)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {report?.fatalError && (
        <p className="mt-2 whitespace-pre-wrap text-[11.5px] text-bad">{report.fatalError}</p>
      )}
    </div>
  )
}

function SelfHealing({ report, track }: { report: RunReport; track: TestScope }): JSX.Element | null {
  const healAndRerun = useStore((s) => s.healAndRerun)
  const healing = useStore((s) => !!s.busyKeys['healAndRerun'])
  const lastHeal = useStore((s) => s.lastHeal)

  // 선택 트랙의 실패만 대상 (전체면 undefined → 전체 힐링)
  const trackFails = report.results.filter(
    (r) =>
      (r.status === 'failed' || r.status === 'timedOut') &&
      (track === 'all' || (track === 'code') === isCodeResult(r))
  )
  const targets =
    track === 'all'
      ? undefined
      : trackFails.map((r) => (r.line ? `${r.file}:${r.line}` : r.file)).filter((x): x is string => !!x)
  const canHeal = !report.fatalError && trackFails.length > 0
  if (!canHeal && !lastHeal) return null

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <SparkleIcon width={15} height={15} className="text-brand-soft" />
            AI 자동 수정 (self-healing)
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-muted">
              대상: {SCOPE_LABEL[track]}
            </span>
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            셀렉터가 바뀌어 깨진 테스트를 AI가 고쳐서 다시 돌립니다. 실제 버그는 고치지 않고
            표시합니다.
          </p>
        </div>
        {canHeal && (
          <Button
            variant="secondary"
            icon={<SparkleIcon width={14} height={14} />}
            loading={healing}
            loadingText="수정 중…"
            onClick={() => void healAndRerun(targets)}
          >
            AI 자동 수정 &amp; 재실행 ({trackFails.length})
          </Button>
        )}
      </div>
      {lastHeal && <HealNotes heal={lastHeal} />}
    </div>
  )
}

function HealNotes({ heal }: { heal: HealResult }): JSX.Element {
  const [open, setOpen] = useState(true)
  const changes = heal.changes ?? []
  const hasChanges = changes.length > 0

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        disabled={!hasChanges}
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex w-full items-center gap-2 text-left',
          hasChanges ? 'cursor-pointer' : 'cursor-default'
        ].join(' ')}
      >
        <span className="text-xs font-semibold text-text">분류·수정 내역</span>
        <span className="font-mono text-[11px] text-muted">
          드리프트 {heal.healed} 수정
        </span>
        {heal.realBugs > 0 && (
          <span className="rounded bg-bad/15 px-1.5 py-0.5 text-[10.5px] font-medium text-bad">
            회귀 의심 {heal.realBugs} — 검토 필요
          </span>
        )}
        {hasChanges && (
          <ChevronIcon
            width={14}
            height={14}
            className={`ml-auto shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {hasChanges && open && (
        <div className="mt-2 space-y-2">
          {changes.map((c, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 ${VERDICT[c.verdict].box}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10.5px] font-semibold ${VERDICT[c.verdict].label}`}>
                  {VERDICT[c.verdict].text}
                </span>
                <span className="truncate font-mono text-[11px] text-muted" title={c.file}>
                  {c.file}
                </span>
              </div>
              <p className="mt-1 break-words text-[11.5px] leading-relaxed text-text/80">
                {c.summary}
              </p>
              {c.diff && (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-bg/60 p-2 font-mono text-[10.5px] leading-relaxed">
                  {c.diff.split('\n').map((line, j) => (
                    <div
                      key={j}
                      className={
                        line.startsWith('+')
                          ? 'text-ok'
                          : line.startsWith('-')
                            ? 'text-bad'
                            : 'text-muted'
                      }
                    >
                      {line}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const VERDICT: Record<string, { text: string; label: string; box: string }> = {
  healed: { text: '드리프트·수정됨', label: 'text-ok', box: 'border-ok/30 bg-ok/5' },
  real_bug: { text: '회귀 의심 (안 고침)', label: 'text-bad', box: 'border-bad/30 bg-bad/5' },
  skipped: { text: '건너뜀', label: 'text-warn', box: 'border-border bg-surface' }
}

const isCodeResult = (r: TestResult): boolean => (r.file ?? '').startsWith('code-')

function ReportView({ report }: { report: RunReport }): JSX.Element {
  const [track, setTrack] = useState<'all' | 'scope' | 'code'>('all')
  const startedAt = new Date(report.startedAt)

  const scopeResults = report.results.filter((r) => !isCodeResult(r))
  const codeResults = report.results.filter((r) => isCodeResult(r))
  const hasBoth = scopeResults.length > 0 && codeResults.length > 0
  const shown = track === 'scope' ? scopeResults : track === 'code' ? codeResults : report.results

  const stat = {
    total: shown.length,
    passed: shown.filter((r) => r.status === 'passed').length,
    failed: shown.filter((r) => r.status === 'failed' || r.status === 'timedOut').length,
    skipped: shown.filter((r) => r.status === 'skipped').length
  }
  const passRate = stat.total > 0 ? Math.round((stat.passed / stat.total) * 100) : 0

  // 체크박스 다중 선택 → 선택한 테스트만 실행 (전체 실행 대신 특정만 재테스트)
  const runTests = useStore((s) => s.runTests)
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const rowKey = (r: TestResult): string => `${r.file ?? ''}\u0001${r.title}\u0001${r.line ?? ''}`
  const keyToTarget = (k: string): string => {
    const [f, , l] = k.split('\u0001')
    return l ? `${f}:${l}` : f
  }
  const toggle = (k: string): void =>
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  const shownKeys = shown.map(rowKey)
  const allSelected = shownKeys.length > 0 && shownKeys.every((k) => selected.has(k))
  const toggleAll = (): void => setSelected(allSelected ? new Set() : new Set(shownKeys))
  const healAndRerun = useStore((s) => s.healAndRerun)
  const healing = useStore((s) => !!s.busyKeys['healAndRerun'])
  const selectedTargets = [...selected].map(keyToTarget).filter(Boolean)
  const runSelected = (): void => {
    if (selectedTargets.length) {
      void runTests(selectedTargets)
      setSelected(new Set())
    }
  }
  const healSelected = (): void => {
    if (selectedTargets.length) {
      void healAndRerun(selectedTargets)
      setSelected(new Set())
    }
  }

  return (
    <div className="space-y-6">
      {report.fatalError && (
        <div className="flex items-start gap-3 rounded-xl border border-bad/40 bg-bad/10 p-4">
          <AlertIcon className="mt-0.5 shrink-0 text-bad" width={18} height={18} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-bad">실행 실패</h3>
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text/80">
              {report.fatalError}
            </p>
          </div>
        </div>
      )}

      {/* 트랙 탭 (두 트랙 결과가 다 있을 때만) */}
      {hasBoth && (
        <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
          <ReportTab active={track === 'all'} onClick={() => setTrack('all')} label="전체" count={report.results.length} />
          <ReportTab active={track === 'scope'} onClick={() => setTrack('scope')} label="개발범위 완료" count={scopeResults.length} />
          <ReportTab active={track === 'code'} onClick={() => setTrack('code')} label="코드 정밀" count={codeResults.length} />
        </div>
      )}

      {/* 요약 통계 (선택 트랙 기준) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="전체" value={stat.total} tone="brand" />
        <StatCard label="통과" value={stat.passed} tone="ok" />
        <StatCard label="실패" value={stat.failed} tone="bad" />
        <StatCard label="건너뜀" value={stat.skipped} tone="muted" />
      </div>

      {/* 메타 + 통과율 바 */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>
            {startedAt.toLocaleString('ko-KR')} · {(report.durationMs / 1000).toFixed(1)}초 소요
          </span>
          <span className="font-medium text-text">통과율 {passRate}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-ok transition-all duration-500"
            style={{ width: `${passRate}%` }}
          />
        </div>
      </div>

      {/* self-healing */}
      <SelfHealing report={report} track={track} />

      {/* negative-control: 기대값 변형 검증 */}
      <NegativeControlBlock scope={track} />

      {/* 결과 목록 (선택 트랙) + 체크박스 다중 선택 실행 */}
      {shown.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-3.5 w-3.5 cursor-pointer accent-brand"
              />
              테스트 결과 ({shown.length})
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted">{selected.size}개 선택</span>
                <Button variant="secondary" loading={running} loadingText="실행 중…" onClick={runSelected}>
                  선택 실행
                </Button>
                <Button
                  variant="secondary"
                  icon={<SparkleIcon width={13} height={13} />}
                  loading={healing}
                  loadingText="힐링 중…"
                  title="선택한 테스트만 self-healing (드리프트/셀렉터 수정 후 재실행)"
                  onClick={healSelected}
                >
                  선택 힐링
                </Button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-[11px] text-muted hover:text-text"
                >
                  해제
                </button>
              </div>
            )}
          </div>
          {shown.map((r, i) => {
            const k = rowKey(r)
            return (
              <ResultRow
                key={`${r.title}-${i}`}
                result={r}
                checked={selected.has(k)}
                onToggle={() => toggle(k)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ReportTab({
  active,
  onClick,
  label,
  count
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors',
        active ? 'bg-surface text-text ring-1 ring-border' : 'text-muted hover:text-text'
      ].join(' ')}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-brand/20 text-brand-soft' : 'bg-surface-2 text-muted'}`}
      >
        {count}
      </span>
    </button>
  )
}

const STAT_TONES: Record<string, string> = {
  brand: 'text-brand-soft',
  ok: 'text-ok',
  bad: 'text-bad',
  muted: 'text-muted'
}

function StatCard({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone: keyof typeof STAT_TONES
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${STAT_TONES[tone]}`}>{value}</p>
    </div>
  )
}

const STATUS_META: Record<TestStatus, { label: string; dot: string; text: string }> = {
  passed: { label: '통과', dot: 'bg-ok', text: 'text-ok' },
  failed: { label: '실패', dot: 'bg-bad', text: 'text-bad' },
  skipped: { label: '건너뜀', dot: 'bg-muted', text: 'text-muted' },
  timedOut: { label: '시간초과', dot: 'bg-warn', text: 'text-warn' }
}

function ResultRow({
  result,
  checked,
  onToggle
}: {
  result: TestResult
  checked?: boolean
  onToggle?: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[result.status]
  const expandable = (result.status === 'failed' || result.status === 'timedOut') && !!result.error

  const rerunTest = useStore((s) => s.rerunTest)
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const reruning = useStore((s) => !!s.busyKeys[`rerun:${result.file}::${result.title}`])
  const canRerun = !!result.file

  return (
    <div
      className={[
        'overflow-hidden rounded-xl border bg-surface transition-colors',
        checked ? 'border-brand/50 ring-1 ring-brand/20' : '',
        result.status === 'failed' || result.status === 'timedOut'
          ? 'border-bad/30'
          : 'border-border'
      ].join(' ')}
    >
      <div className="flex items-center">
        {onToggle && (
          <label className="flex shrink-0 cursor-pointer items-center pl-3">
            <input
              type="checkbox"
              checked={!!checked}
              onChange={onToggle}
              className="h-3.5 w-3.5 cursor-pointer accent-brand"
            />
          </label>
        )}
        <button
          type="button"
          disabled={!expandable}
          onClick={() => setOpen((v) => !v)}
          className={[
            'flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left',
            expandable ? 'cursor-pointer hover:bg-surface-2/50' : 'cursor-default'
          ].join(' ')}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
          <span className="min-w-0 flex-1 truncate text-sm text-text" title={result.title}>
            {result.title}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted">
            {(result.durationMs / 1000).toFixed(2)}s
          </span>
          <span className={`shrink-0 text-xs font-medium ${meta.text}`}>{meta.label}</span>
          {expandable && (
            <ChevronIcon
              width={16}
              height={16}
              className={`shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          )}
        </button>
        {canRerun && (
          <button
            type="button"
            disabled={running || reruning}
            onClick={() => void rerunTest(result.file, result.title, result.line)}
            title="이 테스트만 다시 실행"
            className="shrink-0 border-l border-border px-3 py-3 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            {reruning ? '실행 중…' : '재실행'}
          </button>
        )}
      </div>
      {expandable && open && (
        <pre className="max-h-72 overflow-auto border-t border-border bg-bg px-4 py-3 font-mono text-[11.5px] leading-relaxed text-bad/90">
          {result.error}
        </pre>
      )}
    </div>
  )
}
