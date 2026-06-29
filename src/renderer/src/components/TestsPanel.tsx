import type { JSX } from 'react'
import type { Checklist } from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge } from './common'
import { FlaskIcon, SparkleIcon, CheckIcon, PlayIcon } from './icons'

export function TestsPanel(): JSX.Element {
  const checklists = useStore((s) => s.checklists)
  const generateAllTests = useStore((s) => s.generateAllTests)
  const generatingAll = useStore((s) => !!s.busyKeys['generateAllTests'])
  const approved = checklists.filter((c) => c.status === 'approved')
  const drafts = checklists.filter((c) => c.status !== 'approved')

  const hasPending = approved.some((c) => !c.specPath)

  return (
    <>
      <PanelHeader
        step={3}
        title="테스트 생성"
        desc="승인된 체크리스트를 Playwright 테스트 코드로 변환합니다."
        action={
          hasPending ? (
            <Button
              variant="primary"
              icon={<SparkleIcon />}
              loading={generatingAll}
              loadingText="생성 중…"
              onClick={() => generateAllTests()}
            >
              전체 테스트 생성
            </Button>
          ) : undefined
        }
      />
      <PanelBody>
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
            {hasSpec && (
              <Badge tone="ok" icon={<CheckIcon width={11} height={11} strokeWidth={3} />}>
                생성됨
              </Badge>
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
