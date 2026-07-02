import { useState, type JSX } from 'react'
import type { HealResult, RunReport, TestResult, TestStatus, TestScope } from '@shared/types'
import { useStore } from '../store'

const SCOPE_LABEL: Record<TestScope, string> = { all: '전체', scope: '개발범위', code: '코드' }
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge, InfoTip } from './common'
import { PlayIcon, AlertIcon, ChevronIcon, SparkleIcon } from './icons'
import { TraceabilitySection } from './TraceabilityPanel'

export function RunPanel(): JSX.Element {
  const lastReport = useStore((s) => s.lastReport)
  const runTests = useStore((s) => s.runTests)
  const runFailedTests = useStore((s) => s.runFailedTests)
  const cancelRun = useStore((s) => s.cancelRun)
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const checklists = useStore((s) => s.checklists)
  const testFiles = useStore((s) => s.testFiles)
  const setActiveStep = useStore((s) => s.setActiveStep)
  // 실제 .qa/tests 의 spec 이 하나라도 있으면 실행 가능 (코드 기준 테스트는 체크리스트가 없음)
  const hasSpecs = testFiles.length > 0 || checklists.some((c) => c.specPath)
  const scopeNames = testFiles.filter((f) => f.kind === 'checklist').map((f) => f.name)
  const codeNames = testFiles.filter((f) => f.kind === 'code').map((f) => f.name)
  const hasBothTracks = scopeNames.length > 0 && codeNames.length > 0

  const runBtn = (
    <div className="flex items-center gap-2">
      {hasBothTracks && !running && (
        <>
          <Button variant="secondary" title="개발범위 완료 테스트만 실행" onClick={() => void runTests(scopeNames)}>
            개발범위만
          </Button>
          <Button variant="secondary" title="코드 정밀 테스트만 실행" onClick={() => void runTests(codeNames)}>
            코드만
          </Button>
        </>
      )}
      <Button
        size="lg"
        variant="primary"
        icon={<PlayIcon />}
        loading={running}
        loadingText="실행 중…"
        disabled={!hasSpecs}
        title={hasSpecs ? undefined : '먼저 테스트를 생성하세요'}
        onClick={() => void runTests()}
      >
        {hasBothTracks ? '전체 실행' : 'QA 실행'}
      </Button>
      {running && (
        <Button size="lg" variant="secondary" onClick={() => void cancelRun()}>
          중단
        </Button>
      )}
    </div>
  )

  const failedCount = lastReport && !lastReport.fatalError ? lastReport.failed : 0
  const headerAction = (
    <div className="flex items-center gap-2">
      {failedCount > 0 && !running && (
        <Button variant="secondary" onClick={() => void runFailedTests()}>
          실패만 재실행 ({failedCount})
        </Button>
      )}
      {runBtn}
    </div>
  )

  return (
    <>
      <PanelHeader
        step={4}
        title="실행 & 검증"
        desc="Playwright 결정적 실행 + 항목/테스트 단위 추적성·변경영향·품질 검증(네거티브·flaky·mutation)을 한 곳에서."
        action={lastReport ? headerAction : undefined}
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
            action={
              hasSpecs ? (
                runBtn
              ) : (
                <Button variant="secondary" onClick={() => setActiveStep('tests')}>
                  테스트 생성 단계로 이동 →
                </Button>
              )
            }
          />
        ) : (
          <ReportView report={lastReport} />
        )}
      </PanelBody>
    </>
  )
}

function NegativeControlBlock({ scope }: { scope: TestScope }): JSX.Element {
  const run = useStore((s) => s.runNegativeControl)
  const busy = useStore((s) => !!s.busyKeys['negativeControl'])
  const report = useStore((s) => s.negativeControl)
  const bad = report?.specs.filter((s) => s.verdict === 'vacuous') ?? []

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            기대값 변형 검증 (negative-control)
            <InfoTip>
              <b>이 테스트가 진짜 검증하는지</b> 확인합니다. 통과한 테스트의 기대값을 일부러 틀리게 바꿔
              다시 돌려요. <b className="text-ok">빨개지면</b> 진짜 검증하는 테스트, <b className="text-bad">그대로 통과</b>하면
              알맹이 없는 가짜 테스트(vacuous)예요.
              <br />
              <span className="text-muted">언제: 테스트를 믿어도 되는지 점검할 때. 무거움 · 끝나면 원본 자동 복원 · AI 안 씀.</span>
            </InfoTip>
            <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-muted">
              대상: {SCOPE_LABEL[scope]}
            </span>
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            통과 테스트의 기대값을 일부러 틀리게 바꿔 재실행 → 빨간불이 떠야 '진짜 검증'.
            그래도 통과하면 알맹이 없는 테스트. (무거움 · 끝나면 원본 복원)
          </p>
        </div>
        <Button variant="secondary" loading={busy} loadingText="검증 중… (무거움)" onClick={() => void run(scope)}>
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

function FlakyBlock({ scope }: { scope: TestScope }): JSX.Element {
  const run = useStore((s) => s.runFlakyDetection)
  const busy = useStore((s) => !!s.busyKeys['detectFlaky'])
  const report = useStore((s) => s.flaky)
  const [repeat, setRepeat] = useState(5)

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            Flaky(불안정) 감지
            <InfoTip>
              같은 코드로 각 테스트를 <b>N회 반복 실행</b>해, 통과/실패가 <b>들쭉날쭉한</b> 테스트를 찾습니다.
              랜덤하게 깨지는 테스트가 있으면 결과를 믿을 수 없으니 미리 색출 → &lsquo;결정적 판정&rsquo;의 신뢰를 지켜요.
              <br />
              <span className="text-muted">언제: CI에 넣기 전, 테스트가 매번 같은 결과인지 확인할 때. 무거움 · 재시도 0 · AI 안 씀.</span>
            </InfoTip>
            <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-muted">
              대상: {SCOPE_LABEL[scope]}
            </span>
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            같은 코드로 각 테스트를 N회 반복 실행 → 통과/실패가 섞이면 '불안정'. 랜덤하게 깨지는
            테스트를 색출해 '결정적 판정'의 신뢰를 지킨다. (무거움 · 재시도 0)
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={repeat}
            onChange={(e) => setRepeat(Number(e.target.value))}
            disabled={busy}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-text"
          >
            <option value={3}>3회</option>
            <option value={5}>5회</option>
            <option value={10}>10회</option>
          </select>
          <Button
            variant="secondary"
            loading={busy}
            loadingText="반복 실행 중… (무거움)"
            onClick={() => void run(repeat, scope)}
          >
            반복 실행
          </Button>
        </div>
      </div>
      {report && !report.fatalError && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={report.flaky.length > 0 ? 'bad' : 'ok'}>불안정 {report.flaky.length}</Badge>
            <Badge tone="ok">안정 {report.stable}</Badge>
            {report.failing > 0 && <Badge tone="warn">매번 실패 {report.failing}</Badge>}
            <Badge tone="muted">검사 {report.tested} · {report.repeat}회</Badge>
          </div>
          {report.flaky.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {report.flaky.map((t, i) => (
                <li key={i} className="font-mono text-[11px] text-bad">
                  ⚠ {t.file}:{t.line} — {t.title.slice(0, 48)}{' '}
                  <span className="text-muted">
                    ({t.passed}✓/{t.failed}✗ of {t.runs})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11.5px] text-ok">불안정한 테스트 없음 — 모두 결정적으로 동작합니다.</p>
          )}
        </div>
      )}
      {report?.fatalError && (
        <p className="mt-2 whitespace-pre-wrap text-[11.5px] text-bad">{report.fatalError}</p>
      )}
    </div>
  )
}

function MutationScoreBlock(): JSX.Element {
  const run = useStore((s) => s.runMutationScore)
  const busy = useStore((s) => !!s.busyKeys['mutationScore'])
  const report = useStore((s) => s.mutationReport)
  const [maxMutants, setMaxMutants] = useState(15)

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            Mutation score (스위트 강도)
            <InfoTip>
              <b>테스트가 진짜 버그를 잡는지</b> 잽니다. 소스에 작은 결함(mutant)을 일부러 심고, 테스트가
              그걸 잡는 비율을 계산해요. <b className="text-bad">살아남은 mutant</b> = 아무 테스트도 못 잡는 검증 구멍.
              커버리지(코드를 밟았나)보다 <b>결함검출력을 잘 예측</b>하는 지표예요.
              <br />
              <span className="text-muted">언제: 테스트 스위트가 얼마나 튼튼한지 볼 때. 무거움 · src/lib·api 대상 · 소스 자동 복원 · AI 안 씀.</span>
            </InfoTip>
          </h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            소스 로직(src/lib·api)에 작은 결함(mutant)을 심고 스위트가 잡는 비율을 잰다. 커버리지(밟았나)보다
            결함검출력을 잘 예측. <b className="text-text/80">살아남은 mutant = 아무 테스트도 안 잡는 검증 구멍.</b>
            (무거움 · 소스는 자동 원복)
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={maxMutants}
            onChange={(e) => setMaxMutants(Number(e.target.value))}
            disabled={busy}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-text"
          >
            <option value={8}>mutant 8</option>
            <option value={15}>mutant 15</option>
            <option value={30}>mutant 30</option>
          </select>
          <Button variant="secondary" loading={busy} loadingText="측정 중… (무거움)" onClick={() => void run(maxMutants)}>
            측정
          </Button>
        </div>
      </div>
      {report && !report.fatalError && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={report.score >= 80 ? 'ok' : report.score >= 50 ? 'warn' : 'bad'}>
              score {report.score}%
            </Badge>
            <Badge tone="ok">잡음 {report.killed}</Badge>
            <Badge tone={report.survived > 0 ? 'bad' : 'muted'}>구멍 {report.survived}</Badge>
            <Badge tone="muted">
              mutant {report.tested}/{report.totalMutants} · 파일 {report.targetFiles}
            </Badge>
          </div>
          {report.warning && <p className="mt-2 text-[11px] text-warn">{report.warning}</p>}
          {report.survivors.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {report.survivors.slice(0, 20).map((s, i) => (
                <li key={i} className="font-mono text-[11px] text-bad">
                  ⚠ {s.file}:{s.line} <span className="text-muted">[{s.operator}]</span> {s.snippet.slice(0, 60)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11.5px] text-ok">모든 mutant 를 잡았습니다 — 이 로직에 검증 구멍 없음.</p>
          )}
        </div>
      )}
      {report?.fatalError && (
        <p className="mt-2 whitespace-pre-wrap text-[11.5px] text-bad">{report.fatalError}</p>
      )}
    </div>
  )
}

function SelfHealing({ report, track }: { report: RunReport; track: TestScope }): JSX.Element | null {
  const healAndRerun = useStore((s) => s.healAndRerun)
  const healing = useStore((s) => !!s.busyKeys['healAndRerun'])
  const lastHeal = useStore((s) => s.lastHeal)

  // 선택 트랙의 실패만 대상 (전체면 undefined → 전체 힐링)
  const trackFails = report.results.filter(
    (r) =>
      (r.status === 'failed' || r.status === 'timedOut') &&
      (track === 'all' || (track === 'code') === isCodeResult(r))
  )
  const targets =
    track === 'all'
      ? undefined
      : trackFails.map((r) => (r.line ? `${r.file}:${r.line}` : r.file)).filter((x): x is string => !!x)
  const canHeal = !report.fatalError && trackFails.length > 0
  if (!canHeal && !lastHeal) return null

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <SparkleIcon width={15} height={15} className="text-brand-soft" />
            AI 자동 수정 (self-healing)
            <InfoTip>
              실패한 테스트를 AI가 보고 <b>왜 깨졌는지 분류</b>합니다. 화면이 조금 바뀌어(셀렉터/텍스트 변경)
              깨진 <b>&lsquo;드리프트&rsquo;면 고쳐서 다시 돌리고</b>, 진짜 코드 버그(회귀)면 <b className="text-bad">안 고치고 그대로 표시</b>해요
              (초록으로 세탁 안 함).
              <br />
              <span className="text-muted">언제: UI가 조금 바뀌어 깨진 테스트를 자동 복구할 때. AI는 &lsquo;분류·수정&rsquo;만, 통과 판정은 기계가.</span>
            </InfoTip>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-normal text-muted">
              대상: {SCOPE_LABEL[track]}
            </span>
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
            onClick={() => void healAndRerun(targets)}
          >
            AI 자동 수정 &amp; 재실행 ({trackFails.length})
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
    <div className="mt-3 border-t border-border pt-3">
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

const isCodeResult = (r: TestResult): boolean => (r.file ?? '').startsWith('code-')

function ReportView({ report }: { report: RunReport }): JSX.Element {
  const [track, setTrack] = useState<'all' | 'scope' | 'code'>('all')
  const [detailOpen, setDetailOpen] = useState(false)

  const scopeResults = report.results.filter((r) => !isCodeResult(r))
  const codeResults = report.results.filter((r) => isCodeResult(r))
  const hasBoth = scopeResults.length > 0 && codeResults.length > 0
  const shown = track === 'scope' ? scopeResults : track === 'code' ? codeResults : report.results

  const stat = {
    total: shown.length,
    passed: shown.filter((r) => r.status === 'passed').length,
    failed: shown.filter((r) => r.status === 'failed' || r.status === 'timedOut').length,
    skipped: shown.filter((r) => r.status === 'skipped').length
  }
  const passRate = stat.total > 0 ? Math.round((stat.passed / stat.total) * 100) : 0

  // 체크박스 다중 선택 → 선택한 테스트만 실행 (전체 실행 대신 특정만 재테스트)
  const runTests = useStore((s) => s.runTests)
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const rowKey = (r: TestResult): string => `${r.file ?? ''}\u0001${r.title}\u0001${r.line ?? ''}`
  const keyToTarget = (k: string): string => {
    const [f, , l] = k.split('\u0001')
    return l ? `${f}:${l}` : f
  }
  const toggle = (k: string): void =>
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  const shownKeys = shown.map(rowKey)
  const allSelected = shownKeys.length > 0 && shownKeys.every((k) => selected.has(k))
  const toggleAll = (): void => setSelected(allSelected ? new Set() : new Set(shownKeys))
  const healAndRerun = useStore((s) => s.healAndRerun)
  const healing = useStore((s) => !!s.busyKeys['healAndRerun'])
  const selectedTargets = [...selected].map(keyToTarget).filter(Boolean)
  const runSelected = (): void => {
    if (selectedTargets.length) {
      void runTests(selectedTargets)
      setSelected(new Set())
    }
  }
  const healSelected = (): void => {
    if (selectedTargets.length) {
      void healAndRerun(selectedTargets)
      setSelected(new Set())
    }
  }

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

      {/* ── 주 결과 뷰: 항목/테스트 단위 추적성 + 변경영향(재테스트) ── */}
      <TraceabilitySection />

      {/* 트랙 선택 (아래 품질 도구·상세목록의 대상 스코프) */}
      {hasBoth && (
        <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
          <ReportTab active={track === 'all'} onClick={() => setTrack('all')} label="전체" count={report.results.length} />
          <ReportTab active={track === 'scope'} onClick={() => setTrack('scope')} label="개발범위 완료" count={scopeResults.length} />
          <ReportTab active={track === 'code'} onClick={() => setTrack('code')} label="코드 정밀" count={codeResults.length} />
        </div>
      )}

      {/* 품질 검증 도구 */}
      <SelfHealing report={report} track={track} />
      <NegativeControlBlock scope={track} />
      <FlakyBlock scope={track} />
      <MutationScoreBlock />

      {/* ── 접이식: 상세 실행 결과 + 선택 실행/힐링 (추적성이 주 뷰라 접어둠) ── */}
      <div className="rounded-xl border border-border bg-surface">
        <button
          onClick={() => setDetailOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        >
          <span className="text-[12px] font-medium text-muted">
            상세 실행 결과 · 선택 실행/힐링 — {stat.passed}✓ {stat.failed}✗ {stat.skipped}⤼ (통과율 {passRate}%)
          </span>
          <span className="text-[11px] text-muted">{detailOpen ? '접기' : '펼치기'}</span>
        </button>
        {detailOpen && (
          <div className="space-y-2 border-t border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-3.5 w-3.5 cursor-pointer accent-brand"
              />
              테스트 결과 ({shown.length})
            </label>
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted">{selected.size}개 선택</span>
                <Button variant="secondary" loading={running} loadingText="실행 중…" onClick={runSelected}>
                  선택 실행
                </Button>
                <Button
                  variant="secondary"
                  icon={<SparkleIcon width={13} height={13} />}
                  loading={healing}
                  loadingText="힐링 중…"
                  title="선택한 테스트만 self-healing (드리프트/셀렉터 수정 후 재실행)"
                  onClick={healSelected}
                >
                  선택 힐링
                </Button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-[11px] text-muted hover:text-text"
                >
                  해제
                </button>
              </div>
            )}
          </div>
          {shown.map((r, i) => {
            const k = rowKey(r)
            return (
              <ResultRow
                key={`${r.title}-${i}`}
                result={r}
                checked={selected.has(k)}
                onToggle={() => toggle(k)}
              />
            )
          })}
          </div>
        )}
      </div>
    </div>
  )
}

function ReportTab({
  active,
  onClick,
  label,
  count
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors',
        active ? 'bg-surface text-text ring-1 ring-border' : 'text-muted hover:text-text'
      ].join(' ')}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-brand/20 text-brand-soft' : 'bg-surface-2 text-muted'}`}
      >
        {count}
      </span>
    </button>
  )
}

const STATUS_META: Record<TestStatus, { label: string; dot: string; text: string }> = {
  passed: { label: '통과', dot: 'bg-ok', text: 'text-ok' },
  failed: { label: '실패', dot: 'bg-bad', text: 'text-bad' },
  skipped: { label: '건너뜀', dot: 'bg-muted', text: 'text-muted' },
  timedOut: { label: '시간초과', dot: 'bg-warn', text: 'text-warn' }
}

function ResultRow({
  result,
  checked,
  onToggle
}: {
  result: TestResult
  checked?: boolean
  onToggle?: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[result.status]
  const expandable = (result.status === 'failed' || result.status === 'timedOut') && !!result.error

  const rerunTest = useStore((s) => s.rerunTest)
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const reruning = useStore((s) => !!s.busyKeys[`rerun:${result.file}::${result.title}`])
  const canRerun = !!result.file

  return (
    <div
      className={[
        'overflow-hidden rounded-xl border bg-surface transition-colors',
        checked ? 'border-brand/50 ring-1 ring-brand/20' : '',
        result.status === 'failed' || result.status === 'timedOut'
          ? 'border-bad/30'
          : 'border-border'
      ].join(' ')}
    >
      <div className="flex items-center">
        {onToggle && (
          <label className="flex shrink-0 cursor-pointer items-center pl-3">
            <input
              type="checkbox"
              checked={!!checked}
              onChange={onToggle}
              className="h-3.5 w-3.5 cursor-pointer accent-brand"
            />
          </label>
        )}
        <button
          type="button"
          disabled={!expandable}
          onClick={() => setOpen((v) => !v)}
          className={[
            'flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left',
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
        {canRerun && (
          <button
            type="button"
            disabled={running || reruning}
            onClick={() => void rerunTest(result.file, result.title, result.line)}
            title="이 테스트만 다시 실행"
            className="shrink-0 border-l border-border px-3 py-3 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2/60 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            {reruning ? '실행 중…' : '재실행'}
          </button>
        )}
      </div>
      {expandable && open && (
        <pre className="max-h-72 overflow-auto border-t border-border bg-bg px-4 py-3 font-mono text-[11.5px] leading-relaxed text-bad/90">
          {result.error}
        </pre>
      )}
    </div>
  )
}
