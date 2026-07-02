import { useState, type JSX } from 'react'
import type { TraceChecklistGroup, TraceRow, TraceState } from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState } from './common'
import { GridIcon } from './icons'

/** 상태별 표시(라벨·색). text-ok/warn/bad/brand/muted 는 index.css @theme 토큰. */
const STATE_META: Record<TraceState, { label: string; dot: string; text: string }> = {
  verified: { label: '검증됨', dot: 'bg-ok', text: 'text-ok' },
  failing: { label: '실패', dot: 'bg-bad', text: 'text-bad' },
  'not-run': { label: '미실행', dot: 'bg-muted', text: 'text-muted' },
  'no-test': { label: '테스트 없음', dot: 'bg-warn', text: 'text-warn' },
  draft: { label: '승인 전', dot: 'bg-brand', text: 'text-brand-soft' },
  'no-checklist': { label: '체크리스트 없음', dot: 'bg-warn', text: 'text-warn' }
}

const ORDER: TraceState[] = ['failing', 'no-test', 'no-checklist', 'not-run', 'draft', 'verified']

export function TraceabilityPanel(): JSX.Element {
  const project = useStore((s) => s.project)

  return (
    <>
      <PanelHeader
        step={6}
        title="추적성"
        desc="요구사항 → 체크리스트 → 테스트 → 실행을 한 줄로 이어, 어디서 검증이 끊겼는지 한눈에 봅니다. (기존 산출물만 조인 · AI 미사용)"
      />
      <PanelBody>
        {!project ? (
          <EmptyState
            icon={<GridIcon width={26} height={26} />}
            title="프로젝트를 먼저 연결하세요"
            desc="요구사항·체크리스트·테스트·실행 리포트를 조인해 검증 상태 매트릭스를 만듭니다."
          />
        ) : (
          <TraceabilitySection />
        )}
      </PanelBody>
    </>
  )
}

function TraceabilitySection(): JSX.Element {
  const report = useStore((s) => s.traceability)
  const reload = useStore((s) => s.loadTraceability)
  const [filter, setFilter] = useState<TraceState | 'all'>('all')

  if (!report || report.rows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <RefreshBar onReload={reload} />
        <EmptyState
          icon={<GridIcon width={26} height={26} />}
          title="아직 추적할 산출물이 없습니다"
          desc="요구사항/체크리스트를 만들거나 테스트를 생성한 뒤 새로고침하세요."
        />
      </div>
    )
  }

  const s = report.summary
  const scopeRows = report.rows.filter((r) => r.track === 'scope')
  const codeRows = report.rows.filter((r) => r.track === 'code')
  // 필터 칩 카운트 대상: 항목 그룹이 있으면 '항목' 상태 + 코드행, 없으면 기존 행
  const filterable: TraceState[] =
    report.checklistGroups.length > 0
      ? [...report.checklistGroups.flatMap((g) => g.items.map((i) => i.state)), ...codeRows.map((r) => r.state)]
      : report.rows.map((r) => r.state)
  const shown = (rows: TraceRow[]): TraceRow[] =>
    filter === 'all' ? rows : rows.filter((r) => r.state === filter)
  const sortRows = (rows: TraceRow[]): TraceRow[] =>
    [...rows].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state))

  return (
    <div className="flex flex-col gap-4">
      <RefreshBar onReload={reload} />

      {/* 요약 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="개발범위 검증율"
          value={scopeRows.length ? `${s.verifiedPct}%` : '—'}
          hint={scopeRows.length ? `검증 ${s.verified} · 실패 ${s.failing}` : '요구사항 없음'}
          tone={s.failing > 0 ? 'bad' : 'ok'}
        />
        <Stat label="검증됨" value={String(s.verified)} hint="🟢 통과 확인" tone="ok" />
        <Stat
          label="구멍(gap)"
          value={String(s.gaps)}
          hint="테스트/체크리스트 없음"
          tone={s.gaps > 0 ? 'warn' : 'muted'}
        />
        <Stat
          label="코드 커버리지"
          value={report.codeCoveragePct != null ? `${report.codeCoveragePct}%` : '—'}
          hint={report.lastRunAt ? `실행 ${fmt(report.lastRunAt)}` : '실행 기록 없음'}
          tone="muted"
        />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          전체 {filterable.length}
        </FilterChip>
        {ORDER.map((st) => {
          const n = filterable.filter((x) => x === st).length
          if (n === 0) return null
          return (
            <FilterChip key={st} active={filter === st} onClick={() => setFilter(st)}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATE_META[st].dot}`} />
              {STATE_META[st].label} {n}
            </FilterChip>
          )
        })}
      </div>

      {/* 개발범위 — 항목(합격기준) 단위 검증 (QA 핵심 뷰) */}
      {report.checklistGroups.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[12px] font-medium text-muted">
            개발범위 — 합격기준 항목별 검증 (요구사항 → 항목 → 테스트 → 결과)
          </h3>
          {report.checklistGroups.map((g) => (
            <ChecklistGroupCard key={g.checklistId} group={g} filter={filter} />
          ))}
        </div>
      )}
      {/* 체크리스트 없이 파일만 있는 경우 폴백 (구 파일단위 뷰) */}
      {report.checklistGroups.length === 0 && scopeRows.length > 0 && (
        <TraceTable
          title="개발범위 (요구사항 → 체크리스트 → 테스트)"
          rows={sortRows(shown(scopeRows))}
          showRequirement
        />
      )}

      {/* 코드 트랙 */}
      {codeRows.length > 0 && (
        <TraceTable
          title="코드 트랙 (요구사항 링크 없는 code-*.spec)"
          rows={sortRows(shown(codeRows))}
          showRequirement={false}
        />
      )}
    </div>
  )
}

function RefreshBar({ onReload }: { onReload: () => void }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[12px] text-muted">
        마지막 실행 리포트·체크리스트·커버리지를 조인한 결과입니다. 실행/생성 후 새로고침하세요.
      </p>
      <Button variant="ghost" size="sm" onClick={() => onReload()}>
        새로고침
      </Button>
    </div>
  )
}

function ChecklistGroupCard({
  group,
  filter
}: {
  group: TraceChecklistGroup
  filter: TraceState | 'all'
}): JSX.Element {
  const items = filter === 'all' ? group.items : group.items.filter((i) => i.state === filter)
  const pct = group.total ? Math.round((group.verified / group.total) * 100) : 0
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h4 className="truncate text-[13px] font-medium text-text">{group.title}</h4>
          {group.requirement && (
            <p className="truncate text-[11px] text-muted">요구사항: {group.requirement}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
          <span className={group.verified === group.total ? 'text-ok' : 'text-muted'}>
            {group.verified}/{group.total} 검증 ({pct}%)
          </span>
          {group.failing > 0 && <span className="text-bad">· 실패 {group.failing}</span>}
          {group.noTest > 0 && <span className="text-warn">· 미검증 {group.noTest}</span>}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-center text-[12px] text-muted">이 필터에 해당하는 항목 없음</p>
      ) : (
        <div className="divide-y divide-border/60">
          {items.map((it) => {
            const m = STATE_META[it.state]
            return (
              <div key={it.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-text">{it.text}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                    <span className="font-mono text-[10px]">{it.id}</span>
                    {it.techniqueTags.map((t) => (
                      <span key={t} className="rounded bg-surface-2 px-1 text-[9.5px] text-muted">
                        {t}
                      </span>
                    ))}
                    {it.testTitles.length > 0 ? (
                      <span className="truncate">← {it.testTitles.join(', ')}</span>
                    ) : (
                      <span className="text-warn">← 매핑된 테스트 없음</span>
                    )}
                  </div>
                </div>
                <span className={`shrink-0 text-[11px] font-medium ${m.text}`}>{m.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

function TraceTable({
  title,
  rows,
  showRequirement
}: {
  title: string
  rows: TraceRow[]
  showRequirement: boolean
}): JSX.Element {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5">
        <h3 className="text-[12px] font-medium text-muted">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted">이 필터에 해당하는 행 없음</p>
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map((r, i) => (
            <Row key={`${r.title}-${i}`} row={r} showRequirement={showRequirement} />
          ))}
        </div>
      )}
    </article>
  )
}

function Row({ row, showRequirement }: { row: TraceRow; showRequirement: boolean }): JSX.Element {
  const m = STATE_META[row.state]
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {/* 상태 */}
      <div className="flex w-[104px] shrink-0 items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
        <span className={`text-[12px] font-medium ${m.text}`}>{m.label}</span>
      </div>

      {/* 제목(+요구사항) */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-text">{row.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
          {showRequirement && row.requirement && <span>요구사항: {row.requirement}</span>}
          {row.specFile && <span className="font-mono text-[10.5px]">{row.specFile}</span>}
          {row.checklistStatus === 'draft' && <Tag tone="brand">승인 전</Tag>}
          {row.sourceStale && <Tag tone="warn">요구사항 변경됨</Tag>}
          {row.specStale && <Tag tone="warn">체크리스트 변경됨</Tag>}
        </div>
      </div>

      {/* 실행 결과 */}
      <div className="shrink-0 text-right font-mono text-[11px] tabular-nums">
        {row.run ? (
          <span>
            <span className="text-ok">{row.run.passed}✓</span>
            {row.run.failed > 0 && <span className="text-bad"> {row.run.failed}✗</span>}
            {row.run.skipped > 0 && <span className="text-muted"> {row.run.skipped}⤼</span>}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: string
  hint: string
  tone: 'ok' | 'bad' | 'warn' | 'muted'
}): JSX.Element {
  const toneCls = { ok: 'text-ok', bad: 'text-bad', warn: 'text-warn', muted: 'text-text' }[tone]
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{hint}</div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? 'border-brand/40 bg-brand/10 text-text'
          : 'border-border bg-surface text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function Tag({
  tone,
  children
}: {
  tone: 'warn' | 'brand'
  children: React.ReactNode
}): JSX.Element {
  const cls =
    tone === 'warn' ? 'bg-warn/10 text-warn' : 'bg-brand/10 text-brand-soft'
  return (
    <span className={`rounded px-1.5 py-px text-[10px] font-medium ${cls}`}>{children}</span>
  )
}

function fmt(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes()
    ).padStart(2, '0')}`
  } catch {
    return iso
  }
}
