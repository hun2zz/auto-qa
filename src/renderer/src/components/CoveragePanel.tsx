import type { JSX } from 'react'
import type { CoverageItem, CoverageReport, CoverageStatus } from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge } from './common'
import { ChecklistIcon, DocIcon, SparkleIcon } from './icons'

export function CoveragePanel(): JSX.Element {
  const requirements = useStore((s) => s.requirements)

  return (
    <>
      <PanelHeader
        step={5}
        title="구현 감사"
        desc="요구사항이 실제로 구현됐는지 코드 근거로 감사합니다. (E2E 실행과 별개 · 브라우저 불필요)"
      />
      <PanelBody>
        {requirements.length === 0 ? (
          <EmptyState
            icon={<DocIcon width={26} height={26} />}
            title="감사할 요구사항이 없습니다"
            desc="먼저 1단계 요구사항에서 문서를 업로드하거나 붙여넣으면, 각 요구사항이 실제 코드에 구현됐는지 감사할 수 있습니다."
          />
        ) : (
          <div className="flex flex-col gap-4">
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

function RequirementAudit({ name }: { name: string }): JSX.Element {
  const auditCoverage = useStore((s) => s.auditCoverage)
  const busy = useStore((s) => !!s.busyKeys[`audit:${name}`])
  const report = useStore((s) =>
    s.coverageReports.find((r) => r.requirementName === name)
  )

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      {/* 요구사항 행 */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-soft ring-1 ring-brand/30">
          <ChecklistIcon />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-text" title={name}>
            {name}
          </h3>
          {report && (
            <p className="mt-0.5 text-[11px] text-muted">
              마지막 감사 {formatTime(report.generatedAt)}
            </p>
          )}
        </div>
        <Button
          variant={report ? 'secondary' : 'primary'}
          icon={report ? undefined : <SparkleIcon />}
          loading={busy}
          loadingText="감사 중…"
          onClick={() => void auditCoverage(name)}
        >
          {report ? '다시 감사' : '감사 실행'}
        </Button>
      </div>

      {report && <CoverageSummary report={report} />}
    </article>
  )
}

function CoverageSummary({ report }: { report: CoverageReport }): JSX.Element {
  const pct = Math.round(report.completionRate * 100)
  const sorted = [...report.items].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  )

  return (
    <div className="border-t border-border bg-surface-2/30 px-5 py-5">
      {/* 요약 헤더 */}
      <div className="mb-5">
        <div className="mb-2 flex items-end justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-text">완료율 {pct}%</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Badge tone="ok">구현 {report.implemented}</Badge>
            <Badge tone="warn">부분 {report.partial}</Badge>
            <Badge tone="bad">미구현 {report.missing}</Badge>
            <Badge tone="muted">전체 {report.total}</Badge>
          </div>
        </div>
        {/* 진행 바 */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-border">
          <div
            className="h-full rounded-full bg-ok transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 항목 리스트 (gaps first) */}
      <ul className="flex flex-col gap-2">
        {sorted.map((item, i) => (
          <CoverageRow key={i} item={item} />
        ))}
      </ul>
    </div>
  )
}

function CoverageRow({ item }: { item: CoverageItem }): JSX.Element {
  const meta = STATUS_META[item.status]
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
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </span>
          </div>
          {item.evidence && (
            <p className="mt-1.5 break-words font-mono text-[11.5px] leading-relaxed text-muted">
              {item.evidence}
            </p>
          )}
          {item.note && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted/90">{item.note}</p>
          )}
        </div>
      </div>
    </li>
  )
}

const STATUS_ORDER: Record<CoverageStatus, number> = {
  missing: 0,
  partial: 1,
  implemented: 2
}

const STATUS_META: Record<
  CoverageStatus,
  { label: string; tone: 'ok' | 'warn' | 'bad'; dotClass: string; gapClass: string }
> = {
  implemented: {
    label: '구현',
    tone: 'ok',
    dotClass: 'bg-ok',
    gapClass: 'border-border bg-surface'
  },
  partial: {
    label: '부분',
    tone: 'warn',
    dotClass: 'bg-warn',
    gapClass: 'border-warn/30 bg-warn/5'
  },
  missing: {
    label: '미구현',
    tone: 'bad',
    dotClass: 'bg-bad',
    gapClass: 'border-bad/30 bg-bad/5'
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
