import { useState, type JSX } from 'react'
import type {
  AssertionReport,
  AssertionStrength,
  Checklist,
  EvalResult,
  SelectorValidation,
  TestFile
} from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState, Badge, Menu } from './common'
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
  const strengthenAssertions = useStore((s) => s.strengthenAssertions)
  const strengthening = useStore((s) => !!s.busyKeys['strengthenLoop'])
  const validateSelectors = useStore((s) => s.validateSelectors)
  const validating = useStore((s) => !!s.busyKeys['validateSelectors'])
  const selectorValidation = useStore((s) => s.selectorValidation)
  const runEval = useStore((s) => s.runEval)
  const evaluating = useStore((s) => !!s.busyKeys['runEval'])
  const evalResult = useStore((s) => s.evalResult)
  const testFiles = useStore((s) => s.testFiles)
  const generateTestsForIds = useStore((s) => s.generateTestsForIds)
  const [tab, setTab] = useState<'scope' | 'code'>('scope')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const toggleId = (id: string): void =>
    setSelectedIds((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const approved = checklists.filter((c) => c.status === 'approved')
  const drafts = checklists.filter((c) => c.status !== 'approved')
  const hasPending = approved.some((c) => !c.specPath)
  const scopeFiles = testFiles.filter((f) => f.kind === 'checklist')
  const codeFiles = testFiles.filter((f) => f.kind === 'code')

  return (
    <>
      <PanelHeader
        step={3}
        title="테스트 생성"
        desc="개발범위 완료 테스트(요구사항·흐름)와 코드 정밀 테스트(회귀·커버리지)를 분리해 만들고 봅니다."
        action={
          tab === 'scope' ? (
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Button
                  variant="secondary"
                  icon={<SparkleIcon width={14} height={14} />}
                  onClick={() => {
                    void generateTestsForIds([...selectedIds])
                    setSelectedIds(new Set())
                  }}
                >
                  선택 생성 ({selectedIds.size})
                </Button>
              )}
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
          ) : (
            <Button
              variant="primary"
              icon={<FlaskIcon width={14} height={14} />}
              loading={generatingCode}
              loadingText="생성 중…"
              onClick={() => generateCodeTests()}
            >
              코드 기준 테스트 생성
            </Button>
          )
        }
      />
      <PanelBody>
        {/* 공통 분석 결과 (두 트랙 전체 대상) */}
        {evalResult && (
          <div className="mb-5">
            <EvalReport result={evalResult} />
          </div>
        )}
        {selectorValidation && (
          <div className="mb-5">
            <SelectorValidationReport report={selectorValidation} />
          </div>
        )}
        {assertionReport && (
          <div className="mb-5">
            <AssertionStrengthReport report={assertionReport} />
          </div>
        )}

        {/* 툴바: 트랙 탭(좌) + 보조 도구 메뉴(우) */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2/40 p-1">
            <TabButton
              active={tab === 'scope'}
              onClick={() => setTab('scope')}
              label="개발범위 완료 테스트"
              hint="요구사항·흐름"
              count={scopeFiles.length}
            />
            <TabButton
              active={tab === 'code'}
              onClick={() => setTab('code')}
              label="코드 정밀 테스트"
              hint="회귀·커버리지"
              count={codeFiles.length}
            />
          </div>
          <Menu
            label="품질 검사"
            items={[
              { label: '셀렉터 검증', onClick: () => void validateSelectors(), loading: validating },
              { label: '단언 강도 분석', onClick: () => void analyzeAssertions(), loading: analyzingAssert },
              {
                label: '단언 강화 (약함→강함)',
                icon: <SparkleIcon width={13} height={13} />,
                onClick: () => void strengthenAssertions(80, 3),
                loading: strengthening
              },
              { label: '생성 채점 (이력)', onClick: () => void runEval(), loading: evaluating }
            ]}
          />
        </div>

        {tab === 'scope' ? (
          <div className="space-y-5">
            <p className="text-[12px] leading-relaxed text-muted">
              요구사항→체크리스트→테스트. "이 기능이 개발 범위대로 완료·작동하나"를 흐름 단위로 검증합니다.
            </p>
            {scopeFiles.length > 0 && (
              <TestFilesCard files={scopeFiles} title="개발범위 테스트 파일" />
            )}
            {checklists.length === 0 ? (
              <EmptyState
                icon={<FlaskIcon width={26} height={26} />}
                title="승인된 체크리스트가 없습니다"
                desc="1·2단계에서 요구사항을 올리고 체크리스트를 승인하면 여기서 개발범위 완료 테스트를 만듭니다."
              />
            ) : (
              <div className="space-y-6">
                {approved.length > 0 && (
                  <div className="space-y-3">
                    {approved.map((c) => (
                      <TestRow
                        key={c.id}
                        checklist={c}
                        checked={selectedIds.has(c.id)}
                        onToggle={() => toggleId(c.id)}
                      />
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
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-[12px] leading-relaxed text-muted">
              코드를 직접 분석한 회귀·커버리지 테스트. 요구사항에 없는 동작도 포함하며, 상세할수록 좋습니다.
            </p>
            {codeFiles.length > 0 ? (
              <TestFilesCard files={codeFiles} title="코드 정밀 테스트 파일" />
            ) : (
              <EmptyState
                icon={<FlaskIcon width={26} height={26} />}
                title="코드 정밀 테스트가 없습니다"
                desc="'코드 기준 테스트 생성'을 누르면 코드만으로 회귀·커버리지 테스트를 만듭니다 (요구사항 불필요)."
              />
            )}
          </div>
        )}
      </PanelBody>
    </>
  )
}

function TabButton({
  active,
  onClick,
  label,
  hint,
  count
}: {
  active: boolean
  onClick: () => void
  label: string
  hint: string
  count: number
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex flex-1 flex-col items-start gap-0.5 rounded-lg px-4 py-2.5 text-left transition-colors',
        active ? 'bg-surface text-text ring-1 ring-border' : 'text-muted hover:text-text'
      ].join(' ')}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-brand/20 text-brand-soft' : 'bg-surface-2 text-muted'}`}
        >
          {count}
        </span>
      </span>
      <span className="text-[10.5px] text-muted">{hint}</span>
    </button>
  )
}

function TestFilesCard({ files, title }: { files: TestFile[]; title?: string }): JSX.Element {
  const totalTests = files.reduce((s, f) => s + f.tests, 0)
  const totalFixmes = files.reduce((s, f) => s + f.fixmes, 0)
  const runTests = useStore((s) => s.runTests)
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (name: string): void =>
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(name) ? n.delete(name) : n.add(name)
      return n
    })
  const allSelected = files.length > 0 && files.every((f) => selected.has(f.name))
  const toggleAll = (): void => setSelected(allSelected ? new Set() : new Set(files.map((f) => f.name)))
  const runSelected = (): void => {
    if (selected.size) {
      void runTests([...selected])
      setSelected(new Set())
    }
  }

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-3.5 w-3.5 cursor-pointer accent-brand"
          />
          <span>
            <span className="text-sm font-medium text-text">
              {title ?? '생성된 테스트 파일'} ({files.length})
            </span>
            <span className="mt-0.5 block text-[11px] text-muted">.qa/tests 의 실제 spec 파일.</span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="secondary" loading={running} loadingText="실행 중…" onClick={runSelected}>
              선택 실행 ({selected.size})
            </Button>
          )}
          <Badge tone="ok">테스트 {totalTests}</Badge>
          {totalFixmes > 0 && <Badge tone="muted">비활성 {totalFixmes}</Badge>}
        </div>
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto border-t border-border px-3 py-3">
        {files.map((f) => (
          <li
            key={f.name}
            className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2/40 ${selected.has(f.name) ? 'bg-brand/5 ring-1 ring-brand/20' : ''}`}
          >
            <label className="flex min-w-0 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(f.name)}
                onChange={() => toggle(f.name)}
                className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand"
              />
              <Badge tone={f.kind === 'code' ? 'warn' : 'muted'}>
                {f.kind === 'code' ? '코드' : '요구사항'}
              </Badge>
              <span className="truncate font-mono text-[12px] text-text" title={f.name}>
                {f.name}
              </span>
            </label>
            <span className="shrink-0 text-[11px] text-muted">
              테스트 {f.tests}
              {f.fixmes > 0 ? ` · 비활성 ${f.fixmes}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </article>
  )
}

function TestRow({
  checklist,
  checked,
  onToggle
}: {
  checklist: Checklist
  checked?: boolean
  onToggle?: () => void
}): JSX.Element {
  const generateTests = useStore((s) => s.generateTests)
  const runTests = useStore((s) => s.runTests)
  const generating = useStore((s) => !!s.busyKeys[`tests:${checklist.id}`])
  const running = useStore((s) => !!s.busyKeys['runTests'])
  const hasSpec = !!checklist.specPath

  return (
    <div
      className={[
        'flex items-center justify-between gap-4 rounded-xl border bg-surface p-5 transition-colors',
        checked ? 'border-brand/50 ring-1 ring-brand/20' : hasSpec ? 'border-ok/40 ring-1 ring-ok/15' : 'border-border'
      ].join(' ')}
    >
      <div className="flex min-w-0 items-center gap-3">
        {onToggle && (
          <input
            type="checkbox"
            checked={!!checked}
            onChange={onToggle}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand"
          />
        )}
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

function EvalReport({ result }: { result: EvalResult }): JSX.Element {
  const { current, prev, history } = result
  const delta = prev ? current.strengthPct - prev.strengthPct : null
  const deltaEl =
    delta === null ? (
      <span className="text-[11px] text-muted">첫 측정</span>
    ) : delta > 0 ? (
      <span className="text-[11px] font-semibold text-ok">▲ {delta}p 개선</span>
    ) : delta < 0 ? (
      <span className="text-[11px] font-semibold text-bad">▼ {-delta}p 하락</span>
    ) : (
      <span className="text-[11px] text-muted">변화 없음</span>
    )
  // 미니 막대그래프(최근 이력의 강한단언 %)
  const max = Math.max(100, ...history.map((h) => h.strengthPct))
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h3 className="text-sm font-medium text-text">생성 채점 (이력 추적)</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            프롬프트·규칙을 바꾼 뒤 다시 생성→채점하면 점수가 오르는지 숫자로 보입니다 (정적)
          </p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-2xl font-semibold text-text">{current.strengthPct}%</span>
          {deltaEl}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
        <Badge tone="ok">강함 {current.strong}</Badge>
        <Badge tone="warn">약함 {current.weak}</Badge>
        <Badge tone="bad">공허 {current.vacuous}</Badge>
        <Badge tone={current.inventedSelectors > 0 ? 'bad' : 'muted'}>
          환각셀렉터 {current.inventedSelectors}
        </Badge>
        <Badge tone="muted">전체 {current.total}</Badge>
      </div>
      {history.length > 1 && (
        <div className="border-t border-border bg-surface-2/30 px-5 py-4">
          <p className="mb-2 text-[11.5px] font-medium text-text">
            강한 단언 % 추이 (최근 {history.length}회)
          </p>
          <div className="flex h-20 items-end gap-1">
            {history.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-brand/70"
                style={{ height: `${Math.max(4, (h.strengthPct / max) * 100)}%` }}
                title={`${new Date(h.at).toLocaleString()} · ${h.strengthPct}% (강함 ${h.strong}/${h.total} · 공허 ${h.vacuous} · 환각 ${h.inventedSelectors})`}
              />
            ))}
          </div>
        </div>
      )}
    </article>
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

function SelectorValidationReport({ report }: { report: SelectorValidation }): JSX.Element {
  const clean = report.invented.length === 0
  return (
    <article className={`overflow-hidden rounded-xl border ${clean ? 'border-ok/30' : 'border-bad/30'} bg-surface`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h3 className="text-sm font-medium text-text">셀렉터 검증 (환각 탐지)</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            테스트가 코드에 없는 testid 를 지어내 쓰지 않았나 · spec {report.specsScanned}개 검사
          </p>
        </div>
        <span className={`text-sm font-semibold ${clean ? 'text-ok' : 'text-bad'}`}>
          {clean ? '지어낸 셀렉터 없음 ✓' : `의심 ${report.invented.length}개`}
        </span>
      </div>
      {!clean && (
        <ul className="max-h-60 space-y-1.5 overflow-y-auto border-t border-bad/20 bg-bad/5 px-5 py-3">
          {report.invented.map((iv, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="font-mono text-[11.5px] text-bad">{iv.selector}</span>
              <span className="truncate font-mono text-[10.5px] text-muted">{iv.spec}</span>
            </li>
          ))}
        </ul>
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
