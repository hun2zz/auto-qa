import { useEffect, useState, type JSX } from 'react'
import type { Checklist, RequirementFile } from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge } from './common'
import { MarkdownView } from './MarkdownView'
import { ChecklistIcon, SparkleIcon, CheckIcon } from './icons'

export function ChecklistsPanel(): JSX.Element {
  const requirements = useStore((s) => s.requirements)
  const checklists = useStore((s) => s.checklists)
  const approveAllChecklists = useStore((s) => s.approveAllChecklists)
  const approvingAll = useStore((s) => !!s.busyKeys['approveAll'])

  const hasDraft = checklists.some((c) => c.status !== 'approved')

  return (
    <>
      <PanelHeader
        step={2}
        title="체크리스트"
        desc="요구사항을 Given / When / Then 합격기준으로 변환하고 검토·승인합니다."
        action={
          hasDraft ? (
            <Button
              variant="success"
              icon={<CheckIcon width={14} height={14} strokeWidth={2.5} />}
              loading={approvingAll}
              loadingText="승인 중…"
              onClick={() => approveAllChecklists()}
            >
              전체 승인
            </Button>
          ) : undefined
        }
      />
      <PanelBody>
        {requirements.length === 0 ? (
          <EmptyState
            icon={<ChecklistIcon width={26} height={26} />}
            title="먼저 요구사항을 업로드하세요"
            desc="1단계에서 요구사항 문서를 업로드하면 여기서 체크리스트를 생성할 수 있습니다."
          />
        ) : (
          <div className="space-y-6">
            {requirements.map((req) => (
              <RequirementGroup
                key={req.path}
                requirement={req}
                checklists={checklists.filter((c) => c.sourceRequirement === req.name)}
              />
            ))}
          </div>
        )}
      </PanelBody>
    </>
  )
}

function RequirementGroup({
  requirement,
  checklists
}: {
  requirement: RequirementFile
  checklists: Checklist[]
}): JSX.Element {
  const generateChecklist = useStore((s) => s.generateChecklist)
  const generating = useStore((s) => !!s.busyKeys[`checklist:${requirement.name}`])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-text">{requirement.name}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {checklists.length > 0
              ? `${checklists.length}개의 모듈 체크리스트`
              : '요구사항을 모듈 단위 체크리스트로 분해합니다 (여러 개가 생성될 수 있습니다).'}
          </p>
        </div>
        <Button
          variant={checklists.length > 0 ? 'secondary' : 'primary'}
          icon={<SparkleIcon />}
          loading={generating}
          loadingText="생성 중…"
          onClick={() => generateChecklist(requirement.name)}
        >
          {checklists.length > 0 ? '다시 생성' : '체크리스트 생성'}
        </Button>
      </div>

      {checklists.length > 0 && (
        <div className="space-y-3 pl-4">
          {checklists.map((c) => (
            <ChecklistCard key={c.id} checklist={c} />
          ))}
        </div>
      )}
    </section>
  )
}

function ChecklistCard({ checklist }: { checklist: Checklist }): JSX.Element {
  const saveChecklist = useStore((s) => s.saveChecklist)
  const approveChecklist = useStore((s) => s.approveChecklist)
  const approving = useStore((s) => !!s.busyKeys[`approve:${checklist.id}`])
  const saving = useStore((s) => !!s.busyKeys[`saveChecklist:${checklist.id}`])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(checklist.markdown)

  // 외부에서 markdown 이 갱신되면 동기화 (편집 중이 아닐 때)
  useEffect(() => {
    if (!editing) setDraft(checklist.markdown)
  }, [checklist.markdown, editing])

  const approved = checklist.status === 'approved'

  function commit(): void {
    setEditing(false)
    if (draft !== checklist.markdown) void saveChecklist(checklist.id, draft)
  }

  return (
    <article
      className={[
        'overflow-hidden rounded-xl border bg-surface transition-colors',
        approved ? 'border-ok/40 ring-1 ring-ok/20' : 'border-border'
      ].join(' ')}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1',
              approved
                ? 'bg-ok/15 text-ok ring-ok/30'
                : 'bg-warn/15 text-warn ring-warn/30'
            ].join(' ')}
          >
            <ChecklistIcon width={15} height={15} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-text" title={checklist.title}>
              {checklist.title}
            </h3>
            <p className="truncate text-[11px] text-muted">{checklist.sourceRequirement}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {checklist.sourceStale && (
            <span title="원본 요구사항이 변경됨 — 체크리스트 다시 생성 권장">
              <Badge tone="warn">요구사항 변경됨</Badge>
            </span>
          )}
          {approved ? (
            <Badge tone="ok" icon={<CheckIcon width={11} height={11} strokeWidth={3} />}>
              승인됨
            </Badge>
          ) : (
            <Badge tone="warn">초안</Badge>
          )}
        </div>
      </header>

      <div className="p-5">
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            spellCheck={false}
            className="h-72 w-full resize-y rounded-lg border border-border bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-text outline-none transition-colors focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
          />
        ) : (
          <button
            type="button"
            onClick={() => !approved && setEditing(true)}
            className={[
              'block w-full rounded-lg border border-transparent bg-bg/50 p-4 text-left',
              approved
                ? 'cursor-default'
                : 'cursor-text transition-colors hover:border-border hover:bg-bg'
            ].join(' ')}
            title={approved ? undefined : '클릭하여 편집'}
          >
            {checklist.markdown.trim() ? (
              <MarkdownView source={checklist.markdown} />
            ) : (
              <span className="font-mono text-xs text-muted">(내용 없음)</span>
            )}
          </button>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface-2/40 px-5 py-3">
        <span className="text-[11px] text-muted">
          {approved
            ? '승인 완료 — 3단계에서 테스트를 생성할 수 있습니다.'
            : saving
              ? '저장 중…'
              : editing
                ? '편집 중 — 포커스를 벗어나면 자동 저장됩니다.'
                : '내용을 클릭하여 편집할 수 있습니다.'}
        </span>
        {!approved && (
          <Button
            variant="success"
            icon={<CheckIcon width={14} height={14} strokeWidth={2.5} />}
            loading={approving}
            loadingText="승인 중…"
            onClick={() => approveChecklist(checklist.id)}
          >
            승인
          </Button>
        )}
      </footer>
    </article>
  )
}
