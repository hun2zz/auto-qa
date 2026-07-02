import type { JSX, ReactNode } from 'react'
import { useStore, type StepId } from '../store'
import { Button } from './Button'
import {
  FolderIcon,
  DocIcon,
  ChecklistIcon,
  FlaskIcon,
  SparkleIcon,
  PlayIcon,
  GearIcon,
  CheckIcon,
  TrashIcon
} from './icons'

interface StepDef {
  id: StepId
  index: number
  label: string
  icon: ReactNode
}

const STEPS: StepDef[] = [
  { id: 'requirements', index: 1, label: '요구사항', icon: <DocIcon /> },
  { id: 'checklists', index: 2, label: '체크리스트', icon: <ChecklistIcon /> },
  { id: 'tests', index: 3, label: '테스트 생성', icon: <FlaskIcon /> },
  { id: 'run', index: 4, label: '실행 & 검증', icon: <PlayIcon /> },
  { id: 'coverage', index: 5, label: '코드 커버리지', icon: <FlaskIcon /> }
]

type StepState = 'done' | 'active' | 'idle'

export function Sidebar(): JSX.Element {
  const project = useStore((s) => s.project)
  const activeStep = useStore((s) => s.activeStep)
  const setActiveStep = useStore((s) => s.setActiveStep)
  const openProject = useStore((s) => s.openProject)
  const opening = useStore((s) => !!s.busyKeys['openProject'])
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const resetProject = useStore((s) => s.resetProject)
  const resetting = useStore((s) => !!s.busyKeys['resetProject'])
  const requirements = useStore((s) => s.requirements)
  const checklists = useStore((s) => s.checklists)
  const lastReport = useStore((s) => s.lastReport)
  const codeCoverage = useStore((s) => s.codeCoverage)

  // 각 단계가 "완료"로 보일 조건 (가벼운 휴리스틱)
  const completion: Record<StepId, boolean> = {
    requirements: requirements.length > 0,
    checklists: checklists.some((c) => c.status === 'approved'),
    tests: checklists.some((c) => c.specPath),
    run: !!lastReport && !lastReport.fatalError,
    coverage: !!codeCoverage && !codeCoverage.fatalError
  }

  function stepState(id: StepId): StepState {
    if (id === activeStep) return 'active'
    return completion[id] ? 'done' : 'idle'
  }

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-surface">
      {/* 워드마크 (드래그 영역과 함께) */}
      <div className="drag flex h-[38px] items-center px-5" />
      <div className="px-5 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand-soft ring-1 ring-brand/30">
            <SparkleIcon />
          </div>
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-tight text-text">Auto QA</h1>
            <p className="text-[11px] text-muted">사내 QA 자동화</p>
          </div>
        </div>
      </div>

      {/* 프로젝트 카드 */}
      <div className="px-4">
        {project ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <div className="flex items-center gap-2">
              <FolderIcon className="shrink-0 text-brand-soft" />
              <span className="truncate text-sm font-medium text-text" title={project.name}>
                {project.name}
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted" title={project.path}>
              {project.path}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2.5 w-full"
              loading={opening}
              loadingText="여는 중…"
              onClick={openProject}
            >
              폴더 열기/변경
            </Button>
          </div>
        ) : (
          <Button
            size="lg"
            variant="primary"
            className="w-full"
            icon={<FolderIcon />}
            loading={opening}
            loadingText="여는 중…"
            onClick={openProject}
          >
            프로젝트 폴더 열기
          </Button>
        )}
      </div>

      {/* 단계 네비게이션 */}
      <nav className="mt-6 flex flex-1 flex-col gap-1 px-3">
        <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          파이프라인
        </p>
        {STEPS.map((step) => {
          const state = stepState(step.id)
          const disabled = !project && step.id !== 'requirements'
          const locked = !project
          return (
            <button
              key={step.id}
              disabled={disabled || locked}
              onClick={() => setActiveStep(step.id)}
              className={[
                'no-drag group flex items-center gap-3 rounded-lg px-3 py-2 text-left',
                'transition-colors duration-150',
                state === 'active'
                  ? 'bg-surface-2 text-text'
                  : 'text-muted hover:bg-surface-2/50 hover:text-text',
                disabled || locked ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''
              ].join(' ')}
            >
              <StatusDot state={state} index={step.index} />
              <span
                className={[
                  'flex h-5 w-5 items-center justify-center',
                  state === 'active' ? 'text-text' : ''
                ].join(' ')}
              >
                {step.icon}
              </span>
              <span className="text-sm font-medium">{step.label}</span>
            </button>
          )
        })}
      </nav>

      {/* 하단 설정·초기화 */}
      <div className="space-y-1 border-t border-border p-3">
        <button
          disabled={!project}
          onClick={() => setConfigOpen(true)}
          className="no-drag flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <GearIcon />
          실행 설정
        </button>
        <button
          disabled={!project || resetting}
          onClick={() => void resetProject()}
          className="no-drag flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-bad/10 hover:text-bad disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <TrashIcon />
          {resetting ? '초기화 중…' : '데이터 초기화'}
        </button>
      </div>
    </aside>
  )
}

function StatusDot({ state, index }: { state: StepState; index: number }): JSX.Element {
  if (state === 'done') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok/20 text-ok ring-1 ring-ok/40">
        <CheckIcon width={12} height={12} strokeWidth={3} />
      </span>
    )
  }
  return (
    <span
      className={[
        'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ring-1',
        state === 'active'
          ? 'bg-brand text-white ring-brand'
          : 'bg-surface-2 text-muted ring-border'
      ].join(' ')}
    >
      {index}
    </span>
  )
}
