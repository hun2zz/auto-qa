import { useState, type JSX } from 'react'
import type { CodeCoverageReport } from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState } from './common'
import { FlaskIcon } from './icons'

export function CoveragePanel(): JSX.Element {
  const project = useStore((s) => s.project)

  return (
    <>
      <PanelHeader
        step={5}
        title="코드 커버리지"
        desc="생성된 테스트(요구사항 기준 + 코드 기준)가 실제 코드 라인 몇 %를 실행하는지 측정합니다. (서버+클라, production 빌드)"
      />
      <PanelBody>
        {!project ? (
          <EmptyState
            icon={<FlaskIcon width={26} height={26} />}
            title="프로젝트를 먼저 연결하세요"
            desc="폴더를 연결하고 테스트를 생성한 뒤, 그 테스트가 코드를 얼마나 덮는지 측정할 수 있습니다."
          />
        ) : (
          <CodeCoverageSection />
        )}
      </PanelBody>
    </>
  )
}

function CodeCoverageSection(): JSX.Element {
  const report = useStore((s) => s.codeCoverage)
  const run = useStore((s) => s.runCodeCoverage)
  const busy = useStore((s) => !!s.busyKeys['runCodeCoverage'])
  const runLoop = useStore((s) => s.runCoverageLoop)
  const looping = useStore((s) => !!s.busyKeys['runCoverageLoop'])
  const anyBusy = busy || looping
  const [target, setTarget] = useState(70)
  const [iters, setIters] = useState(3)

  return (
    <div className="flex flex-col gap-4">
      <article className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text ring-1 ring-border">
            <FlaskIcon />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-text">코드 커버리지 측정 (서버+클라)</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              `.qa/tests/*` 의 생성된 테스트를 실제로 실행 · nextcov(V8) · production 빌드라 무겁습니다(수 분).
            </p>
          </div>
          <Button
            variant="primary"
            icon={busy ? undefined : <FlaskIcon width={14} height={14} />}
            loading={busy}
            disabled={anyBusy}
            loadingText="측정 중… (수 분)"
            onClick={() => void run()}
          >
            {report ? '다시 측정' : '코드 커버리지 측정'}
          </Button>
        </div>

        {/* 흐름 기반 커버리지 루프 */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-2/20 px-5 py-3">
          <span className="text-[11.5px] font-medium text-text">흐름 기반 자동 루프</span>
          <span className="text-[11px] text-muted">
            측정 → gap을 flow로 묶어 flow 테스트 생성 → 목표까지 반복
          </span>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-muted">
              목표
              <input
                type="number"
                value={target}
                min={1}
                max={100}
                onChange={(e) => setTarget(Number(e.target.value) || 0)}
                className="h-7 w-14 rounded-md border border-border bg-bg px-2 text-center text-xs text-text outline-none focus:border-brand/60"
              />
              %
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted">
              반복
              <input
                type="number"
                value={iters}
                min={1}
                max={6}
                onChange={(e) => setIters(Number(e.target.value) || 1)}
                className="h-7 w-12 rounded-md border border-border bg-bg px-2 text-center text-xs text-text outline-none focus:border-brand/60"
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              loading={looping}
              disabled={anyBusy}
              loadingText="루프 중… (오래 걸림)"
              onClick={() => void runLoop(target, iters)}
            >
              루프 실행
            </Button>
          </div>
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
              <span>
                실행된 파일 {report.executedFiles}/{report.totalFiles}
              </span>
              <span>실행한 테스트 spec {report.routes.length}개</span>
            </div>
            {report.warning && <p className="mt-2 text-[11.5px] text-warn">⚠ {report.warning}</p>}

            {report.gaps.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-medium text-text">
                  테스트가 안 닿은 파일 (gap) · 낮은 순{' '}
                  <span className="font-normal text-muted">
                    — 여기에 테스트를 추가하면 커버리지가 오릅니다
                  </span>
                </p>
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface">
                  {report.gaps.map((g) => (
                    <li
                      key={g.file}
                      className="flex items-center justify-between gap-3 px-3 py-1.5"
                    >
                      <span className="truncate font-mono text-[11.5px] text-muted" title={g.file}>
                        {g.file}
                      </span>
                      <span
                        className={`shrink-0 text-[11px] font-medium ${
                          g.pct === 0 ? 'text-bad' : g.pct < 50 ? 'text-warn' : 'text-muted'
                        }`}
                      >
                        {g.pct}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              커버리지가 낮으면 = 테스트가 아직 부족하다는 신호. 모듈을 더 생성하고 로그인(auth)/시드를
              붙이면 올라갑니다.
            </p>
          </div>
        )}
        {report?.fatalError && (
          <div className="border-t border-bad/30 bg-bad/5 px-5 py-3">
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-bad">
              실패: {report.fatalError}
            </p>
          </div>
        )}
      </article>
    </div>
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
        <div
          className="h-full rounded-full bg-ok transition-all duration-500"
          style={{ width: `${m.pct}%` }}
        />
      </div>
      <p className="mt-1 text-[10.5px] text-muted">
        {m.covered}/{m.total}
      </p>
    </div>
  )
}
