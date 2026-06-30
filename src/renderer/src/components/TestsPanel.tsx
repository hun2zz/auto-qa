import type { JSX } from 'react'
import type { AssertionReport, AssertionStrength, Checklist } from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge } from './common'
import { FlaskIcon, SparkleIcon, CheckIcon, PlayIcon } from './icons'

export function TestsPanel(): JSX.Element {
  const checklists = useStore((s) => s.checklists)
  const generateAllTests = useStore((s) => s.generateAllTests)
  const generatingAll = useStore((s) => !!s.busyKeys['generateAllTests'])
  const generateCodeTests = useStore((s) => s.generateCodeTests)
  const generatingCode = useStore((s) => !!s.busyKeys['generateCodeTests'])
  const analyzeAssertions = useStore((s) => s.analyzeAssertions)
  const analyzingAssert = useStore((s) => !!s.busyKeys['analyzeAssertions'])
  const assertionReport = useStore((s) => s.assertionReport)
  const approved = checklists.filter((c) => c.status === 'approved')
  const drafts = checklists.filter((c) => c.status !== 'approved')

  const hasPending = approved.some((c) => !c.specPath)

  return (
    <>
      <PanelHeader
        step={3}
        title="테스트 생성"
        desc="① 요구사항 기준(정확성) · ② 코드 기준(회귀·커버리지, 요구사항에 없는 것 포함) 두 종류를 만듭니다."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              loading={analyzingAssert}
              loadingText="분석 중…"
              onClick={() => analyzeAssertions()}
            >
              단언 강도 분석
            </Button>
            <Button
              variant="secondary"
              icon={<FlaskIcon width={14} height={14} />}
              loading={generatingCode}
              loadingText="생성 중…"
              onClick={() => generateCodeTests()}
            >
              코드 기준 테스트 생성
            </Button>
            {hasPending && (
              <Button
                variant="primary"
                icon={<SparkleIcon />}
                loading={generatingAll}
                loadingText="생성 중…"
                onClick={() => generateAllTests()}
              >
                전체 테스트 생성
              </Button>
            )}
          </div>
        }
      />
      <PanelBody>
        {assertionReport && (
          <div className="mb-5">
            <AssertionStrengthReport report={assertionReport} />
          </div>
        )}
        {checklists.length === 0 ? (
          <EmptyState
            icon={<FlaskIcon width={26} height={26} />}
            title="승인된 체크리스트가 없습니다"
            desc="2단계에서 체크리스트를 생성하고 승인하면 여기서 테스트 코드를 생성할 수 있습니다."
          />
        ) : (
          <div className="space-y-6">
            {approved.length > 0 && (
              <div className="space-y-3">
                {approved.map((c) => (
                  <TestRow key={c.id} checklist={c} />
                ))}
              </div>
            )}

            {drafts.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  승인 대기 ({drafts.length})
                </p>
                <div className="space-y-2">
                  {drafts.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-surface/40 px-5 py-3.5"
                    >
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-text/70">{c.title}</h3>
                        <p className="truncate text-[11px] text-muted">{c.sourceRequirement}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-warn">
                        먼저 2단계에서 승인이 필요합니다
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </PanelBody>
    </>
  )
}

function TestRow({ checklist }: { checklist: Checklist }): JSX.Element {
  const generateTests = useStore((s) => s.generateTests)
  const runTests = useStore((s) => s.runTests)
  const generating = useStore((s) => !!s.busyKeys[`tests:${checklist.id}`])
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const hasSpec = !!checklist.specPath

  return (
    <div
      className={[
        'flex items-center justify-between gap-4 rounded-xl border bg-surface p-5 transition-colors',
        hasSpec ? 'border-ok/40 ring-1 ring-ok/15' : 'border-border'
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
            hasSpec ? 'bg-ok/15 text-ok ring-ok/30' : 'bg-brand/15 text-brand-soft ring-brand/30'
          ].join(' ')}
        >
          <FlaskIcon />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-text" title={checklist.title}>
              {checklist.title}
            </h3>
            {hasSpec && !checklist.specStale && (
              <Badge tone="ok" icon={<CheckIcon width={11} height={11} strokeWidth={3} />}>
                생성됨
              </Badge>
            )}
            {hasSpec && checklist.specStale && (
              <span title="체크리스트가 변경됨 — 테스트 재생성 권장">
                <Badge tone="warn">변경됨 · 재생성 필요</Badge>
              </span>
            )}
          </div>
          {hasSpec ? (
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title={checklist.specPath ?? ''}>
              {checklist.specPath}
            </p>
          ) : (
            <p className="mt-0.5 truncate text-[11px] text-muted">{checklist.sourceRequirement}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {hasSpec && checklist.specPath && (
          <Button
            variant="secondary"
            size="sm"
            icon={<PlayIcon width={13} height={13} />}
            disabled={running}
            onClick={() => runTests(checklist.specPath ?? undefined)}
          >
            이것만 실행
          </Button>
        )}
        <Button
          variant={hasSpec ? 'secondary' : 'primary'}
          icon={<SparkleIcon />}
          loading={generating}
          loadingText="AI 생성 중…"
          onClick={() => generateTests(checklist.id)}
        >
          {hasSpec ? '다시 생성' : '테스트 생성'}
        </Button>
      </div>
    </div>
  )
}

function AssertionStrengthReport({ report }: { report: AssertionReport }): JSX.Element {
  // 약함·공허 먼저 (이미 백엔드 정렬). 강함/스킵은 접어서 요약만.
  const weakOrVacuous = report.tests.filter(
    (t) => t.strength === 'weak' || t.strength === 'vacuous'
  )
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h3 className="text-sm font-medium text-text">단언 강도</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            테스트가 '진짜 값/상태'를 검증하나 (커버리지보다 중요한 지표 · 정적 분석)
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-text">{report.strengthPct}%</span>
          <span className="text-[11px] text-muted">강한 단언</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
        <Badge tone="ok">강함 {report.strong}</Badge>
        <Badge tone="warn">약함 {report.weak}</Badge>
        <Badge tone="bad">공허 {report.vacuous}</Badge>
        <Badge tone="muted">스킵 {report.skipped}</Badge>
        <Badge tone="muted">전체 {report.total}</Badge>
      </div>
      {weakOrVacuous.length > 0 && (
        <div className="border-t border-border bg-surface-2/30 px-5 py-4">
          <p className="mb-2 text-[11.5px] font-medium text-text">
            고쳐야 할 약한·공허 단언 ({weakOrVacuous.length})
            <span className="font-normal text-muted"> — 강한 값 단언으로 재생성하세요</span>
          </p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {weakOrVacuous.map((t, i) => (
              <li
                key={i}
                className={`rounded-lg border px-3 py-2 ${ASTONE[t.strength].box}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10.5px] font-semibold ${ASTONE[t.strength].label}`}>
                    {ASTONE[t.strength].text}
                  </span>
                  <span className="truncate text-[12px] text-text" title={t.title}>
                    {t.title}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[10.5px] text-muted">
                  {t.spec} · {t.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

const ASTONE: Record<AssertionStrength, { text: string; label: string; box: string }> = {
  strong: { text: '강함', label: 'text-ok', box: 'border-ok/30 bg-ok/5' },
  weak: { text: '약함', label: 'text-warn', box: 'border-warn/30 bg-warn/5' },
  vacuous: { text: '공허', label: 'text-bad', box: 'border-bad/30 bg-bad/5' },
  skipped: { text: '스킵', label: 'text-muted', box: 'border-border bg-surface' }
}
