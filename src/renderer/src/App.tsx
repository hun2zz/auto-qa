import { useEffect, type JSX } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { RequirementsPanel } from './components/RequirementsPanel'
import { ChecklistsPanel } from './components/ChecklistsPanel'
import { TestsPanel } from './components/TestsPanel'
import { RunPanel } from './components/RunPanel'
import { CoveragePanel } from './components/CoveragePanel'
import { ProgressConsole } from './components/ProgressConsole'
import { ConfigModal } from './components/ConfigModal'
import { Toasts } from './components/Toasts'
import { Button } from './components/Button'
import { FolderIcon, FlaskIcon } from './components/icons'

export default function App(): JSX.Element {
  const project = useStore((s) => s.project)
  const activeStep = useStore((s) => s.activeStep)
  const initProgress = useStore((s) => s.initProgress)
  const openProject = useStore((s) => s.openProject)
  const restoreLastProject = useStore((s) => s.restoreLastProject)
  const opening = useStore((s) => !!s.busyKeys['openProject'])

  // 진행 상황 구독은 마운트 시 한 번만
  useEffect(() => {
    const unsubscribe = initProgress()
    return unsubscribe
  }, [initProgress])

  // 앱 시작 시 마지막으로 연 프로젝트 자동 복원
  useEffect(() => {
    void restoreLastProject()
  }, [restoreLastProject])

  return (
    <div className="flex h-full w-full bg-bg">
      <Sidebar />

      {/* 메인 영역 */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* 상단 드래그 스트립 */}
        <div className="drag h-[38px] shrink-0 border-b border-border/60" />

        {project ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col">
              {activeStep === 'requirements' && <RequirementsPanel />}
              {activeStep === 'checklists' && <ChecklistsPanel />}
              {activeStep === 'tests' && <TestsPanel />}
              {activeStep === 'run' && <RunPanel />}
              {activeStep === 'coverage' && <CoveragePanel />}
            </div>
            <ProgressConsole />
          </>
        ) : (
          <Welcome onOpen={openProject} opening={opening} />
        )}
      </main>

      <ConfigModal />
      <Toasts />
    </div>
  )
}

function Welcome({ onOpen, opening }: { onOpen: () => void; opening: boolean }): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/15 ring-1 ring-brand/40">
        <FlaskIcon className="text-brand-soft" width={28} height={28} />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-text">Auto QA에 오신 것을 환영합니다</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
        프로젝트 폴더를 연결하면 요구사항 분석 → 체크리스트 생성 → 테스트 코드 생성 → 자동 실행까지
        QA 전 과정을 안내합니다.
      </p>
      <div className="mt-7">
        <Button
          size="lg"
          variant="primary"
          icon={<FolderIcon />}
          loading={opening}
          loadingText="여는 중…"
          onClick={onOpen}
        >
          프로젝트 폴더 열기
        </Button>
      </div>

      {/* 파이프라인 미리보기 */}
      <div className="mt-12 flex items-center gap-3 text-xs text-muted">
        {['요구사항', '체크리스트', '테스트 생성', '실행 & 리포트'].map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            <span className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold">
                {i + 1}
              </span>
              {label}
            </span>
            {i < 3 && <span className="text-border">→</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
