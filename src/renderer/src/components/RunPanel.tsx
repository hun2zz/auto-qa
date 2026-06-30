import { useState, type JSX } from 'react'
import type { HealResult, RunReport, TestResult, TestStatus } from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge } from './common'
import { PlayIcon, AlertIcon, ChevronIcon, SparkleIcon } from './icons'

export function RunPanel(): JSX.Element {
  const lastReport = useStore((s) => s.lastReport)
  const runTests = useStore((s) => s.runTests)
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const checklists = useStore((s) => s.checklists)
  const hasSpecs = checklists.some((c) => c.specPath)

  const runBtn = (
    <Button
      size="lg"
      variant="primary"
      icon={<PlayIcon />}
      loading={running}
      loadingText="실행 중…"
      disabled={!hasSpecs}
      title={hasSpecs ? undefined : '먼저 테스트를 생성하세요'}
      onClick={runTests}
    >
      QA 실행
    </Button>
  )

  return (
    <>
      <PanelHeader
        step={4}
        title="실행 & 리포트"
        desc="dev 서버를 구동하고 Playwright 테스트를 실행한 뒤 결과를 확인합니다."
        action={lastReport ? runBtn : undefined}
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
            action={hasSpecs ? runBtn : undefined}
          />
        ) : (
          <ReportView report={lastReport} />
        )}
      </PanelBody>
    </>
  )
}

function NegativeControlBlock(): JSX.Element {
  const run = useStore((s) => s.runNegativeControl)
  const busy = useStore((s) => !!s.busyKeys['negativeControl'])
  const report = useStore((s) => s.negativeControl)
  const bad = report?.specs.filter((s) => s.verdict === 'vacuous') ?? []

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">기대값 변형 검증 (negative-control)</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            통과 테스트의 기대값을 일부러 틀리게 바꿔 재실행 → 빨간불이 떠야 '진짜 검증'.
            그래도 통과하면 알맹이 없는 테스트. (무거움 · 끝나면 원본 복원)
          </p>
        </div>
        <Button variant="secondary" loading={busy} loadingText="검증 중… (무거움)" onClick={() => void run()}>
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

function SelfHealing({ report }: { report: RunReport }): JSX.Element | null {
  const healAndRerun = useStore((s) => s.healAndRerun)
  const healing = useStore((s) => !!s.busyKeys['healAndRerun'])
  const lastHeal = useStore((s) => s.lastHeal)

  const canHeal = !report.fatalError && report.failed > 0
  if (!canHeal && !lastHeal) return null

  return (
    <div className="rounded-xl border border-brand/30 bg-brand/[0.06] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <SparkleIcon width={15} height={15} className="text-brand-soft" />
            AI 자동 수정 (self-healing)
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
            onClick={() => void healAndRerun()}
          >
            AI 자동 수정 &amp; 재실행 (self-healing)
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
    <div className="mt-3 border-t border-brand/20 pt-3">
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

function ReportView({ report }: { report: RunReport }): JSX.Element {
  const startedAt = new Date(report.startedAt)
  const passRate = report.total > 0 ? Math.round((report.passed / report.total) * 100) : 0

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

      {/* 요약 통계 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="전체" value={report.total} tone="brand" />
        <StatCard label="통과" value={report.passed} tone="ok" />
        <StatCard label="실패" value={report.failed} tone="bad" />
        <StatCard label="건너뜀" value={report.skipped} tone="muted" />
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
      <SelfHealing report={report} />

      {/* negative-control: 기대값 변형 검증 */}
      <NegativeControlBlock />

      {/* 결과 목록 */}
      {report.results.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            테스트 결과 ({report.results.length})
          </p>
          {report.results.map((r, i) => (
            <ResultRow key={`${r.title}-${i}`} result={r} />
          ))}
        </div>
      )}
    </div>
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

function ResultRow({ result }: { result: TestResult }): JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[result.status]
  const expandable = (result.status === 'failed' || result.status === 'timedOut') && !!result.error

  return (
    <div
      className={[
        'overflow-hidden rounded-xl border bg-surface transition-colors',
        result.status === 'failed' || result.status === 'timedOut'
          ? 'border-bad/30'
          : 'border-border'
      ].join(' ')}
    >
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex w-full items-center gap-3 px-4 py-3 text-left',
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
      {expandable && open && (
        <pre className="max-h-72 overflow-auto border-t border-border bg-bg px-4 py-3 font-mono text-[11.5px] leading-relaxed text-bad/90">
          {result.error}
        </pre>
      )}
    </div>
  )
}
