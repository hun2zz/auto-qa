import type { JSX } from 'react'
import type {
  CodeCoverageReport,
  CoverageItem,
  CoverageKind,
  CoverageReport,
  CoverageStatus
} from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge } from './common'
import { ChecklistIcon, DocIcon, SparkleIcon, FlaskIcon } from './icons'

export function CoveragePanel(): JSX.Element {
  const requirements = useStore((s) => s.requirements)

  return (
    <>
      <PanelHeader
        step={5}
        title="커버리지 감사"
        desc="요구사항이 ① 실제로 구현됐는지, ② 테스트로 검증되는지 코드 근거로 감사합니다. (브라우저 불필요)"
      />
      <PanelBody>
        {requirements.length === 0 ? (
          <EmptyState
            icon={<DocIcon width={26} height={26} />}
            title="감사할 요구사항이 없습니다"
            desc="먼저 1단계 요구사항에서 문서를 업로드하거나 붙여넣으면, 각 요구사항의 구현·테스트 커버리지를 감사할 수 있습니다."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <CodeCoverageSection />
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <SparkleIcon width={13} height={13} />※ AI 판정이므로 evidence(근거)를 함께 확인하세요.
            </p>
            {requirements.map((req) => (
              <RequirementAudit key={req.path} name={req.name} />
            ))}
          </div>
        )}
      </PanelBody>
    </>
  )
}

function CodeCoverageSection(): JSX.Element {
  const report = useStore((s) => s.codeCoverage)
  const run = useStore((s) => s.runCodeCoverage)
  const busy = useStore((s) => !!s.busyKeys['runCodeCoverage'])

  return (
    <article className="overflow-hidden rounded-xl border border-brand/30 bg-brand/[0.04]">
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-soft ring-1 ring-brand/30">
          <FlaskIcon />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-text">코드 커버리지 (서버+클라)</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            테스트가 실제 코드 라인 몇 %를 실행하는지. nextcov(V8) · production 빌드라 무겁습니다(수 분).
          </p>
        </div>
        <Button
          variant="primary"
          icon={busy ? undefined : <FlaskIcon width={14} height={14} />}
          loading={busy}
          loadingText="측정 중… (수 분)"
          onClick={() => void run()}
        >
          {report ? '다시 측정' : '코드 커버리지 측정'}
        </Button>
      </div>

      {report && !report.fatalError && (
        <div className="border-t border-border bg-surface-2/30 px-5 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <CodeMetric label="라인" m={report.lines} primary />
            <CodeMetric label="구문" m={report.statements} />
            <CodeMetric label="함수" m={report.functions} />
            <CodeMetric label="분기" m={report.branches} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
            <span>실행된 파일 {report.executedFiles}/{report.totalFiles}</span>
            <span>실행한 테스트 spec {report.routes.length}개</span>
          </div>
          {report.warning && (
            <p className="mt-2 text-[11.5px] text-warn">⚠ {report.warning}</p>
          )}
        </div>
      )}
      {report?.fatalError && (
        <div className="border-t border-bad/30 bg-bad/5 px-5 py-3">
          <p className="text-[12px] leading-relaxed text-bad">실패: {report.fatalError}</p>
        </div>
      )}
    </article>
  )
}

function CodeMetric({
  label,
  m,
  primary = false
}: {
  label: string
  m: CodeCoverageReport['lines']
  primary?: boolean
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted">{label}</span>
        <span className={`text-lg font-semibold ${primary ? 'text-text' : 'text-muted'}`}>
          {m.pct}%
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-border">
        <div className="h-full rounded-full bg-ok transition-all duration-500" style={{ width: `${m.pct}%` }} />
      </div>
      <p className="mt-1 text-[10.5px] text-muted">
        {m.covered}/{m.total}
      </p>
    </div>
  )
}

function RequirementAudit({ name }: { name: string }): JSX.Element {
  const auditCoverage = useStore((s) => s.auditCoverage)
  const implBusy = useStore((s) => !!s.busyKeys[`audit:implementation:${name}`])
  const testBusy = useStore((s) => !!s.busyKeys[`audit:test:${name}`])
  const implReport = useStore((s) =>
    s.coverageReports.find((r) => r.requirementName === name && r.kind === 'implementation')
  )
  const testReport = useStore((s) =>
    s.coverageReports.find((r) => r.requirementName === name && r.kind === 'test')
  )

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-soft ring-1 ring-brand/30">
          <ChecklistIcon />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-text" title={name}>
            {name}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted">
            구현 {pctText(implReport)} · 테스트 {pctText(testReport)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            loading={implBusy}
            loadingText="감사 중…"
            onClick={() => void auditCoverage(name, 'implementation')}
          >
            {implReport ? '구현 재감사' : '구현 감사'}
          </Button>
          <Button
            variant="secondary"
            loading={testBusy}
            loadingText="감사 중…"
            onClick={() => void auditCoverage(name, 'test')}
          >
            {testReport ? '테스트 재감사' : '테스트 커버리지'}
          </Button>
        </div>
      </div>

      {implReport && <CoverageSummary report={implReport} />}
      {testReport && <CoverageSummary report={testReport} />}
    </article>
  )
}

function pctText(report?: CoverageReport): string {
  return report ? `${Math.round(report.completionRate * 100)}%` : '–'
}

function CoverageSummary({ report }: { report: CoverageReport }): JSX.Element {
  const pct = Math.round(report.completionRate * 100)
  const L = LABELS[report.kind]
  const sorted = [...report.items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

  return (
    <div className="border-t border-border bg-surface-2/30 px-5 py-5">
      <div className="mb-5">
        <div className="mb-2 flex items-end justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-brand-soft">
              {L.title}
            </span>
            <span className="text-2xl font-semibold tracking-tight text-text">{pct}%</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Badge tone="ok">
              {L.ok} {report.implemented}
            </Badge>
            <Badge tone="warn">부분 {report.partial}</Badge>
            <Badge tone="bad">
              {L.bad} {report.missing}
            </Badge>
            <Badge tone="muted">전체 {report.total}</Badge>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-border">
          <div
            className="h-full rounded-full bg-ok transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {sorted.map((item, i) => (
          <CoverageRow key={i} item={item} kind={report.kind} />
        ))}
      </ul>
    </div>
  )
}

function CoverageRow({ item, kind }: { item: CoverageItem; kind: CoverageKind }): JSX.Element {
  const meta = STATUS_META[item.status]
  const label = LABELS[kind][item.status]
  const isGap = item.status !== 'implemented'

  return (
    <li
      className={[
        'rounded-lg border px-3.5 py-3 transition-colors',
        isGap ? meta.gapClass : 'border-border bg-surface'
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dotClass}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-medium leading-relaxed text-text">{item.requirement}</p>
            <span className="shrink-0">
              <Badge tone={meta.tone}>{label}</Badge>
            </span>
          </div>
          {item.evidence && (
            <p className="mt-1.5 break-words font-mono text-[11.5px] leading-relaxed text-muted">
              {item.evidence}
            </p>
          )}
          {item.note && <p className="mt-1 text-[12px] leading-relaxed text-muted/90">{item.note}</p>}
        </div>
      </div>
    </li>
  )
}

const STATUS_ORDER: Record<CoverageStatus, number> = { missing: 0, partial: 1, implemented: 2 }

/** kind 별 라벨 (구현 vs 테스트검증) */
const LABELS: Record<
  CoverageKind,
  { title: string; ok: string; bad: string } & Record<CoverageStatus, string>
> = {
  implementation: {
    title: '구현',
    ok: '구현',
    bad: '미구현',
    implemented: '구현',
    partial: '부분',
    missing: '미구현'
  },
  test: {
    title: '테스트',
    ok: '검증됨',
    bad: '미검증',
    implemented: '검증됨',
    partial: '부분',
    missing: '미검증'
  }
}

const STATUS_META: Record<
  CoverageStatus,
  { tone: 'ok' | 'warn' | 'bad'; dotClass: string; gapClass: string }
> = {
  implemented: { tone: 'ok', dotClass: 'bg-ok', gapClass: 'border-border bg-surface' },
  partial: { tone: 'warn', dotClass: 'bg-warn', gapClass: 'border-warn/30 bg-warn/5' },
  missing: { tone: 'bad', dotClass: 'bg-bad', gapClass: 'border-bad/30 bg-bad/5' }
}
