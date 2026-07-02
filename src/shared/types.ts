// ============================================================================
// 공유 타입 — main / preload / renderer 가 모두 참조하는 단일 계약(contract)
// ============================================================================

/** 연결된 프로젝트 정보 */
export interface ProjectInfo {
  /** 프로젝트 루트 절대경로 */
  path: string
  /** 폴더명 (표시용) */
  name: string
  /** .qa 폴더가 이미 존재했는지 */
  hasQaFolder: boolean
}

/** .qa/config.json — 타겟 앱을 어떻게 구동하고 인증할지 */
export interface QaConfig {
  /** dev 서버 실행 명령 (예: "npm run dev") */
  devCommand: string
  /** 서버가 준비됐는지 폴링할 URL */
  readyUrl: string
  /** 테스트 baseURL */
  baseURL: string
  /** 서버 준비 대기 최대 시간(ms) */
  readyTimeoutMs: number
  /** 첫 실패 N개 발생 시 즉시 중단(fail-fast). 0/미설정이면 끝까지 */
  maxFailures?: number
  /** 시드데이터: 테스트 전 결정적 상태를 만드는 (선택, opt-in) */
  seed?: {
    /** 켜야만 setupCommand 가 실행됨 */
    enabled: boolean
    /** 테스트 전 실행할 시드/리셋 명령 (예: "npm run db:seed"). ⚠️ 테스트 DB 를 가리키게 할 것 */
    setupCommand: string
  }
  /** 로그인 시드 (선택). 비밀번호는 config 에 저장하지 않고 safeStorage 로 암호화 보관 */
  auth?: {
    enabled: boolean
    loginUrl: string
    /** 아이디/이메일 (비밀번호는 별도 암호화 저장) */
    user: string
  }
}

export const DEFAULT_QA_CONFIG: QaConfig = {
  devCommand: 'npm run dev',
  readyUrl: 'http://localhost:3000',
  baseURL: 'http://localhost:3000',
  readyTimeoutMs: 60000
}

/** 요구사항 문서 파일 */
export interface RequirementFile {
  /** .qa/requirements/ 기준 파일명 */
  name: string
  /** 절대경로 */
  path: string
  /** 미리보기용 앞부분 텍스트 */
  preview: string
}

/** 단계별로 쪼갠 가드레일 규칙 파일 (.qa/rules/*.md) */
export interface RuleFile {
  /** 파일명 (예: 20-tests.md) */
  name: string
  /** 적용 단계 (예: "all" 또는 "tests,healing") */
  scope: string
  /** 전체 내용 (frontmatter 포함, 편집용) */
  content: string
}

// ----------------------------------------------------------------------------
// QA 1: 구현 완료 커버리지 감사 (요구사항이 실제로 구현됐는지)
// ----------------------------------------------------------------------------

export type CoverageStatus = 'implemented' | 'partial' | 'missing'

export interface CoverageItem {
  /** 요구사항 항목 설명 */
  requirement: string
  status: CoverageStatus
  /** 판정 근거 (파일 경로/심볼 또는 사유) */
  evidence: string
  note?: string
}

/** 커버리지 감사 종류: 구현 여부 vs 테스트 검증 여부 */
export type CoverageKind = 'implementation' | 'test'

export interface CoverageReport {
  /** implementation = 구현됐나, test = 테스트로 검증되나 */
  kind: CoverageKind
  requirementName: string
  generatedAt: string
  total: number
  implemented: number
  partial: number
  missing: number
  /** 완료율 0~1 = (구현 + 0.5*부분) / 전체 */
  completionRate: number
  items: CoverageItem[]
}

// ----------------------------------------------------------------------------
// 코드 커버리지 (서버+클라, nextcov V8 기반 · production 빌드)
// ----------------------------------------------------------------------------

export interface CoverageMetric {
  pct: number
  covered: number
  total: number
}

/** 커버리지 낮은 파일 (gap) */
export interface CoverageGap {
  /** 프로젝트 기준 상대경로 */
  file: string
  /** 라인 커버리지 % */
  pct: number
}

export interface CodeCoverageReport {
  generatedAt: string
  /** 커버리지 낮은 파일 목록 (오름차순, 상위 N). "여기 테스트 없다" 지도 */
  gaps: CoverageGap[]
  statements: CoverageMetric
  branches: CoverageMetric
  functions: CoverageMetric
  lines: CoverageMetric
  /** 실제로 한 줄이라도 실행된 파일 수 */
  executedFiles: number
  /** 커버리지 대상 전체 파일 수 */
  totalFiles: number
  /** 크롤링한 라우트 */
  routes: string[]
  /** 경고/제약 (소스맵 누락 등) */
  warning?: string
  /** 실행 실패 사유 */
  fatalError?: string
}

// ----------------------------------------------------------------------------
// 단언 강도 분석 (생성된 테스트가 '진짜 값'을 검증하나 — 가짜 단언 방어)
// ----------------------------------------------------------------------------

export type AssertionStrength = 'strong' | 'weak' | 'vacuous' | 'skipped'

export interface AssertionTest {
  spec: string
  title: string
  strength: AssertionStrength
  /** expect 개수 */
  assertions: number
  /** 약함/공허 사유 */
  reason?: string
}

export interface AssertionReport {
  total: number
  strong: number
  weak: number
  vacuous: number
  skipped: number
  /** 강한 단언 비율 = strong / (전체 - skipped) */
  strengthPct: number
  /** 약하거나 공허한 테스트(고쳐야 할 것) 먼저 */
  tests: AssertionTest[]
}

// ----------------------------------------------------------------------------
// grounding 인덱스 (AI 가 셀렉터를 지어내지 못하게)
// ----------------------------------------------------------------------------

export interface CodeIndex {
  testids: string[]
  ariaLabels: string[]
  routes: string[]
  builtAt: string
}

export interface SelectorValidation {
  specsScanned: number
  testidsInProject: number
  /** 인덱스에 없는(지어낸 의심) 셀렉터 */
  invented: { spec: string; selector: string }[]
}

// ----------------------------------------------------------------------------
// negative-control: 기대값을 틀리게 변형 → 빨간불 떠야 진짜 검증
// ----------------------------------------------------------------------------

export type SensitivityVerdict = 'sensitive' | 'vacuous' | 'no-assertion'

export interface SensitivitySpec {
  spec: string
  verdict: SensitivityVerdict
  /** 변형한 단언 수 */
  mutations: number
}

export interface NegativeControlReport {
  tested: number
  /** 변형 시 빨간불 = 진짜 검증함 */
  sensitive: number
  /** 변형해도 통과 = 알맹이 없음 */
  vacuous: number
  specs: SensitivitySpec[]
  fatalError?: string
}

// ----------------------------------------------------------------------------
// Flaky(불안정) 감지: 같은 코드로 N회 반복 실행 → 결과가 들쭉날쭉한 테스트 색출.
// "Playwright 가 결정적으로 판정" 이라는 전제를 지키기 위한 신뢰 지표.
// ----------------------------------------------------------------------------

/** 반복 실행 결과가 섞인(불안정) 테스트 1개 */
export interface FlakyTest {
  /** spec 파일명 (rootDir 기준) */
  file?: string
  title: string
  line?: number
  /** N회 중 통과 횟수 */
  passed: number
  /** N회 중 실패/타임아웃 횟수 */
  failed: number
  /** 실제 실행된 횟수 (skip 제외) */
  runs: number
}

export interface FlakyReport {
  /** 반복 횟수 (--repeat-each N) */
  repeat: number
  /** 평가한 테스트 수 */
  tested: number
  /** 통과/실패가 섞인 불안정 테스트 (가장 문제) */
  flaky: FlakyTest[]
  /** 매번 통과 (안정) */
  stable: number
  /** 매번 실패 (불안정 아님 = 진짜 실패) */
  failing: number
  fatalError?: string
}

// ----------------------------------------------------------------------------
// Mutation score: 소스에 결함(mutant)을 심고 스위트가 잡는 비율 = 스위트의 '진짜 강도'.
// 코드 커버리지(밟았나)보다 결함검출력을 잘 예측한다. 살아남은 mutant = 검증 구멍.
// ----------------------------------------------------------------------------

/** 스위트가 못 잡은(살아남은) mutant = 그 코드 변경을 아무 테스트도 감지 못 함 */
export interface SurvivedMutant {
  /** 프로젝트 기준 상대경로 */
  file: string
  line: number
  /** 변형 연산자 (예: "< → <=") */
  operator: string
  /** 변형된 줄 */
  snippet: string
}

export interface MutationScoreReport {
  /** 변형 대상 파일 수 */
  targetFiles: number
  /** 생성된 총 mutant 수(캡 적용 전) */
  totalMutants: number
  /** 실제 실행한 mutant 수(캡/샘플 후) */
  tested: number
  /** 스위트가 잡은 mutant */
  killed: number
  /** 스위트가 못 잡은 mutant */
  survived: number
  /** mutation score = killed / tested × 100 */
  score: number
  /** 살아남은 mutant 목록(검증 구멍) */
  survivors: SurvivedMutant[]
  fatalError?: string
  warning?: string
}

// ----------------------------------------------------------------------------
// 생성기 채점 (프롬프트/규칙 변경이 생성 품질을 올렸나 — 이력 추적)
// ----------------------------------------------------------------------------

export interface EvalScore {
  at: string
  total: number
  strong: number
  weak: number
  vacuous: number
  /** 강한 단언 % */
  strengthPct: number
  /** 지어낸(환각) 셀렉터 수 */
  inventedSelectors: number
}

export interface EvalResult {
  current: EvalScore
  /** 직전 점수 (delta 계산용) */
  prev: EvalScore | null
  /** 최근 이력 */
  history: EvalScore[]
}

/** .qa/tests 의 실제 생성된 spec 파일 (체크리스트와 무관하게 코드기준 테스트도 포함) */
export interface TestFile {
  name: string
  /** code-*.spec.ts(코드 기준) vs 체크리스트 기반 */
  kind: 'code' | 'checklist'
  tests: number
  /** test.fixme/skip 개수 (비활성) */
  fixmes: number
}

/** 품질 검사/분석 대상 트랙 (전체 · 개발범위 완료 · 코드 정밀) */
export type TestScope = 'all' | 'scope' | 'code'

export type ChecklistStatus = 'draft' | 'approved'

/** Given/When/Then 합격기준 묶음 (한 요구사항 → 한 체크리스트) */
export interface Checklist {
  /** kebab-case 식별자 (파일명 기반) */
  id: string
  /** 표시용 제목 */
  title: string
  /** 원본 요구사항 파일명 */
  sourceRequirement: string
  /** 마크다운 본문 (Given/When/Then 목록) */
  markdown: string
  status: ChecklistStatus
  /** 이 체크리스트로 생성된 테스트 spec 경로 (생성 전이면 null) */
  specPath: string | null
  /** 원본 요구사항/의도 파일이 체크리스트보다 최신 = flow 변경됨 → 체크리스트 재생성 권장 */
  sourceStale?: boolean
  /** 체크리스트가 spec 보다 최신 = 체크리스트 변경됨 → 테스트 재생성 권장 */
  specStale?: boolean
}

/**
 * 체크리스트 '항목' 하나 (합격기준 1개). 마크다운 GWT 불릿을 구조화한 것.
 * 파일 단위가 아니라 이 '항목 단위'로 검증 상태를 추적하는 게 QA 앱의 핵심.
 */
export interface ChecklistItem {
  /** 안정 ID (예: login__flow-03). 테스트 annotation 이 이 ID 를 참조해 항목↔테스트를 잇는다. */
  id: string
  /** 소속 체크리스트 id */
  checklistId: string
  /** 항목 본문(Given/When/Then 포함, 셀렉터 힌트 제외 정리본) */
  text: string
  /** 적용된 블랙박스 기법 태그 (EP/BVA/DT/ST) */
  techniqueTags: string[]
}

// ----------------------------------------------------------------------------
// 변경 영향 분석 (TIA): 마지막 실행 이후 바뀐 소스 → 영향받는 테스트를 표시(재테스트 필수).
// 에디터에서 코드를 고치면 파일 mtime 이 바뀌고, 그걸 마지막 실행 시각과 비교한다.
// ----------------------------------------------------------------------------

/** 변경 파일이 영향을 주는 spec (그 파일을 커버한다고 선언/언급) */
export interface AffectedSpec {
  /** spec 파일명 (basename) */
  spec: string
  /** 이 spec 이 커버하는(=변경된) 소스 파일들 */
  changedFiles: string[]
}

export interface ChangeImpactReport {
  /** 마지막 실행 시각(ISO). 없으면 null */
  lastRunAt: string | null
  /** 마지막 실행 이후 변경된 소스 파일 (프로젝트 상대경로) */
  changedFiles: string[]
  /** 재테스트 필요 여부 (변경 파일 있음) */
  stale: boolean
  /** 변경의 영향을 받는 spec 들 (Phase 2 매핑). 재테스트 필수 대상 */
  affectedSpecs: AffectedSpec[]
}

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'timedOut'

/** 개별 테스트 결과 */
export interface TestResult {
  title: string
  status: TestStatus
  durationMs: number
  /** 실패 시 에러 메시지 */
  error?: string
  /** 이 테스트가 속한 spec 파일 (Playwright rootDir 기준 상대경로) */
  file?: string
  /** spec 의 줄 번호 (실패만 재실행 시 file:line 으로 정밀 타깃) */
  line?: number
  /** 이 테스트가 커버하는 체크리스트 항목 ID들 (annotation type=criterion). 항목↔실행 연결용 */
  criteria?: string[]
}

/** 한 번의 실행 리포트 */
export interface RunReport {
  /** ISO 문자열 (main 에서 stamp) */
  startedAt: string
  durationMs: number
  total: number
  passed: number
  failed: number
  skipped: number
  results: TestResult[]
  /** 실행 자체가 실패한 경우(서버 구동 실패 등) */
  fatalError?: string
}

// ----------------------------------------------------------------------------
// 추적성(Traceability): 요구사항 → 체크리스트 → 테스트 → 실행을 한 줄로 잇는다.
// 새로 수집하지 않고 기존 산출물(.qa/*)을 조인만 한다 → 결정적, AI 미사용.
// ----------------------------------------------------------------------------

/** 한 행의 검증 상태(신호등). 위에서부터 우선순위로 판정. */
export type TraceState =
  | 'verified' // 테스트 있고 마지막 실행 전부 통과
  | 'failing' // 테스트 있고 실패 포함
  | 'not-run' // 테스트는 있는데 실행 기록 없음
  | 'no-test' // (승인된) 체크리스트는 있는데 테스트 미생성
  | 'draft' // 체크리스트가 아직 승인 전
  | 'no-checklist' // 요구사항은 있는데 체크리스트 없음

/** 추적 행 하나 (체크리스트 단위 = scope, 또는 요구사항 링크 없는 code-*.spec = code) */
export interface TraceRow {
  track: 'scope' | 'code'
  /** scope: 원본 요구사항 파일명 · code: null */
  requirement: string | null
  /** 체크리스트 제목 또는 spec 파일명 */
  title: string
  checklistId: string | null
  checklistStatus: ChecklistStatus | null
  /** 연결된 spec 파일명(basename) · 없으면 null */
  specFile: string | null
  /** 요구사항이 체크리스트보다 최신 = 재분해 권장 */
  sourceStale?: boolean
  /** 체크리스트가 spec 보다 최신 = 테스트 재생성 권장 */
  specStale?: boolean
  /** 마지막 실행에서 이 spec 의 결과 집계 · 실행 기록 없으면 null */
  run: { passed: number; failed: number; skipped: number; total: number } | null
  state: TraceState
}

/** 항목(합격기준) 하나의 검증 상태 */
export interface TraceItem {
  id: string
  text: string
  techniqueTags: string[]
  state: TraceState
  /** 이 항목을 커버하는(annotation 으로 선언한) 테스트 제목들 */
  testTitles: string[]
}

/** 체크리스트 하나를 '항목 단위'로 펼친 그룹 */
export interface TraceChecklistGroup {
  checklistId: string
  title: string
  requirement: string | null
  checklistStatus: ChecklistStatus | null
  specFile: string | null
  items: TraceItem[]
  /** 항목 요약 */
  total: number
  verified: number
  failing: number
  noTest: number
}

/** 코드 트랙 spec 파일 하나를 '테스트 단위'로 펼친 그룹 (합격기준 없음 → 테스트 제목이 단위) */
export interface CodeTestGroup {
  file: string
  passed: number
  failed: number
  skipped: number
  total: number
  tests: Array<{ title: string; status: TestStatus; line?: number }>
}

export interface TraceabilityReport {
  generatedAt: string
  rows: TraceRow[]
  /** 항목 단위 뷰 (체크리스트별). 파일 단위 rows 를 대체하는 QA 핵심 화면. */
  checklistGroups: TraceChecklistGroup[]
  /** 코드 트랙 테스트 단위 뷰 (code-*.spec 파일별로 테스트 펼침) */
  codeGroups: CodeTestGroup[]
  summary: {
    requirements: number
    checklists: number
    specs: number
    verified: number
    failing: number
    /** no-test + no-checklist (검증 안 되는 구멍) */
    gaps: number
    /** 개발범위(scope) 행 중 verified 비율 0~100 */
    verifiedPct: number
  }
  /** 참고 지표 */
  codeCoveragePct?: number
  lastRunAt?: string
}

// ----------------------------------------------------------------------------
// 진행 상황 스트리밍 이벤트 (main → renderer, webContents.send)
// ----------------------------------------------------------------------------

export type ProgressPhase =
  | 'analyze'
  | 'checklist'
  | 'tests'
  | 'devserver'
  | 'playwright'
  | 'idle'

export interface ProgressEvent {
  phase: ProgressPhase
  /** 사람이 읽는 한 줄 상태 */
  message: string
  /** 0~1, 모르면 생략 */
  fraction?: number
  /** claude / playwright 의 raw 로그 한 줄 (콘솔 표시용) */
  log?: string
  /** 해당 phase 가 끝났는지 */
  done?: boolean
  /** 에러로 끝났는지 */
  error?: boolean
}

// ----------------------------------------------------------------------------
// IPC 채널 이름 (preload / main 공유)
// ----------------------------------------------------------------------------

export const IPC = {
  openProject: 'project:open',
  getLastProject: 'project:last',
  getRecentProjects: 'project:recent',
  reopenProject: 'project:reopen',
  getConfig: 'project:getConfig',
  saveConfig: 'project:saveConfig',
  listRules: 'rules:list',
  saveRule: 'rules:save',
  resetProject: 'project:reset',
  analyzeSeed: 'seed:analyze',
  generateSeed: 'seed:generate',
  getKnownWorld: 'seed:get',
  saveKnownWorld: 'seed:save',
  listRequirements: 'req:list',
  uploadRequirement: 'req:upload',
  addRequirementText: 'req:addText',
  getRequirementDetail: 'req:detail',
  saveRequirement: 'req:save',
  deleteRequirement: 'req:delete',
  generateChecklist: 'checklist:generate',
  listChecklists: 'checklist:list',
  saveChecklist: 'checklist:save',
  approveChecklist: 'checklist:approve',
  approveAllChecklists: 'checklist:approveAll',
  generateTests: 'tests:generate',
  generateAllTests: 'tests:generateAll',
  generateCodeTests: 'tests:generateCode',
  listTestFiles: 'tests:listFiles',
  analyzeAssertions: 'tests:assertionStrength',
  strengthenLoop: 'tests:strengthen',
  runEval: 'tests:eval',
  rebuildIndex: 'index:build',
  validateSelectors: 'index:validate',
  runTests: 'tests:run',
  runFailedTests: 'tests:runFailed',
  cancelRun: 'tests:cancel',
  negativeControl: 'tests:negativeControl',
  detectFlaky: 'tests:detectFlaky',
  mutationScore: 'tests:mutationScore',
  getLastReport: 'report:last',
  auditCoverage: 'coverage:audit',
  getCoverageReports: 'coverage:list',
  runCodeCoverage: 'coverage:code:run',
  getCodeCoverage: 'coverage:code:get',
  runCoverageLoop: 'coverage:code:loop',
  getTraceability: 'trace:get',
  getChangeImpact: 'trace:changeImpact',
  // auth
  getAuthStatus: 'auth:status',
  setAuthSecret: 'auth:setSecret',
  generateAuthSetup: 'auth:generateSetup',
  // self-healing
  healAndRerun: 'tests:heal',
  progress: 'progress:event'
} as const

/** 로그인(auth) 설정 상태 */
export interface AuthStatus {
  enabled: boolean
  /** 비밀번호가 암호화 저장돼 있는지 */
  hasSecret: boolean
  /** auth.setup.ts(로그인 셋업 테스트)가 생성됐는지 */
  hasSetupSpec: boolean
  /** 이 머신에서 암호화(safeStorage) 사용 가능 여부 */
  encryptionAvailable: boolean
}

/** self-healing 결과 */
/** 드리프트(고침) vs 회귀(안 고침, 플래그) 분류 */
export type HealVerdict = 'healed' | 'real_bug' | 'skipped'

/** spec 한 개에 대한 self-healing 판정·변경 내역 (리뷰용) */
export interface HealChange {
  file: string
  verdict: HealVerdict
  /** AI 한 줄 요약 */
  summary: string
  /** 실제로 바뀐 라인 diff (회귀면 되돌려서 없음) */
  diff?: string
}

export interface HealResult {
  /** 수정 시도한 spec 파일 수 */
  attempted: number
  /** 셀렉터 드리프트로 판정해 실제로 고친 수 */
  healed: number
  /** 실제 회귀(버그)로 판정해 '안 고치고 플래그'한 수 — 절대 초록으로 세탁하지 않음 */
  realBugs: number
  /** 재실행 후 리포트 */
  report: RunReport
  /** spec별 판정·diff (리뷰용) */
  changes: HealChange[]
  /** 사람이 읽는 요약 (호환용) */
  notes: string[]
}

// ----------------------------------------------------------------------------
// preload 가 renderer 에 노출하는 API 표면 (window.api)
// ----------------------------------------------------------------------------

export interface AutoQaApi {
  /** 폴더 선택 다이얼로그 → 프로젝트 연결 (.qa 없으면 생성) */
  openProject(): Promise<ProjectInfo | null>
  /** 앱 시작 시: 마지막으로 연 프로젝트 자동 재연결 (없으면 null) */
  getLastProject(): Promise<ProjectInfo | null>
  /** 최근 연 프로젝트 경로 목록 */
  getRecentProjects(): Promise<string[]>
  /** 특정 경로의 프로젝트를 다시 연결 */
  reopenProject(path: string): Promise<ProjectInfo | null>
  /** 생성물 삭제 (네이티브 확인 다이얼로그). 반환=수행한 범위 또는 'cancel' */
  resetProject(projectPath: string): Promise<'generated' | 'all' | 'cancel'>

  /** [AI] 프로젝트의 시드 스크립트/스키마를 분석해 'known-world'(시드된 결정적 상태) 문서 생성 + setupCommand 제안. 파괴적 실행 없음 */
  analyzeSeed(projectPath: string): Promise<{ knownWorld: string; suggestedCommand: string }>
  /** [AI] DB 스키마 → 테스트 시드 스크립트(.qa/seed/seed.mjs) 생성. 반환=실행 명령 */
  generateSeed(projectPath: string): Promise<{ scriptRel: string; command: string }>
  /** .qa/seed/known-world.md 내용 (없으면 빈 문자열) */
  getKnownWorld(projectPath: string): Promise<string>
  saveKnownWorld(projectPath: string, content: string): Promise<void>
  getConfig(projectPath: string): Promise<QaConfig>
  saveConfig(projectPath: string, config: QaConfig): Promise<void>
  /** .qa/rules/*.md — 단계별로 쪼갠 가드레일 규칙 (무신사식). 해당 phase 규칙만 AI 에 주입됨 */
  listRules(projectPath: string): Promise<RuleFile[]>
  saveRule(projectPath: string, name: string, content: string): Promise<void>

  listRequirements(projectPath: string): Promise<RequirementFile[]>
  /** 파일 선택 → .qa/requirements/ 로 복사 (md/txt/pdf/이미지 등) */
  uploadRequirement(projectPath: string): Promise<RequirementFile | null>
  /** 텍스트를 직접 붙여넣어 .qa/requirements/<name>.md 로 저장 */
  addRequirementText(
    projectPath: string,
    title: string,
    content: string
  ): Promise<RequirementFile>
  /** 요구사항 상세(전체 내용). PDF/이미지는 editable=false */
  getRequirementDetail(
    projectPath: string,
    name: string
  ): Promise<{ name: string; content: string; editable: boolean }>
  /** 요구사항 내용 수정 저장 (텍스트 계열만) */
  saveRequirement(projectPath: string, name: string, content: string): Promise<void>
  /** 요구사항 삭제 */
  deleteRequirement(projectPath: string, name: string): Promise<void>

  /** [AI] 요구사항 → 모듈 분해 → 모듈별 Given/When/Then 체크리스트들 생성 */
  generateChecklist(projectPath: string, requirementName: string): Promise<Checklist[]>
  listChecklists(projectPath: string): Promise<Checklist[]>
  saveChecklist(projectPath: string, id: string, markdown: string): Promise<void>
  approveChecklist(projectPath: string, id: string): Promise<Checklist>
  /** 모든 draft 체크리스트 일괄 승인 */
  approveAllChecklists(projectPath: string): Promise<Checklist[]>

  /** [AI] 승인된 체크리스트 → Playwright 테스트 코드 생성 */
  generateTests(projectPath: string, checklistId: string): Promise<Checklist>
  /** [AI] 승인됐고 spec 없는 체크리스트들 → 테스트 일괄 생성(병렬) */
  generateAllTests(projectPath: string): Promise<Checklist[]>
  /** [AI] 코드 기준 characterization(회귀+커버리지) 테스트 생성. 반환=생성 파일 수 */
  generateCodeTests(projectPath: string): Promise<number>
  /** .qa/tests 의 실제 생성된 spec 파일 목록 (체크리스트 없이도 보임) */
  listTestFiles(projectPath: string): Promise<TestFile[]>
  /** [정적] 생성된 테스트의 단언 강도 분석 (실행 없음). scope=대상 트랙 */
  analyzeAssertions(projectPath: string, scope?: TestScope): Promise<AssertionReport>
  /** [AI 루프] 약한/공허 단언을 강한 값 단언으로 재작성 → 목표 강도까지 반복 */
  strengthenLoop(
    projectPath: string,
    targetPct: number,
    maxIterations: number,
    scope?: TestScope
  ): Promise<AssertionReport>
  /** [정적] 생성 품질 채점 + 이력 기록 (프롬프트/규칙 변경 전후 비교) */
  runEval(projectPath: string, scope?: TestScope): Promise<EvalResult>
  /** grounding 인덱스 재빌드 (진짜 셀렉터/라우트 추출) */
  rebuildIndex(projectPath: string): Promise<CodeIndex>
  /** 생성된 테스트의 셀렉터를 인덱스로 검증 (지어낸 것 탐지). scope=대상 트랙 */
  validateSelectors(projectPath: string, scope?: TestScope): Promise<SelectorValidation>

  /** [결정적] dev 서버 구동 → playwright 실행 → 리포트. only=단일 spec 또는 트랙 spec 목록 */
  runTests(projectPath: string, only?: string | string[]): Promise<RunReport>
  /** 직전 리포트에서 실패/타임아웃한 테스트만 재실행 (file:line 정밀 타깃, 없으면 파일 단위) */
  runFailedTests(projectPath: string): Promise<RunReport>
  /** 진행 중인 runTests 를 중단 (Playwright 종료 + dev 서버 정리) */
  cancelRun(projectPath: string): Promise<void>
  /** [무거움] 통과 테스트의 기대값을 틀리게 변형해 재실행 → 진짜 검증하는지(sensitive) 확인 */
  negativeControl(projectPath: string, scope?: TestScope): Promise<NegativeControlReport>
  /** [Flaky 감지] 선택 대상을 N회 반복 실행 → 결과가 섞인 불안정 테스트 색출 */
  detectFlaky(projectPath: string, repeat: number, scope?: TestScope): Promise<FlakyReport>
  /** [Mutation score] 소스에 결함을 심고 스위트가 잡는 비율 측정 (스위트 강도) */
  mutationScore(projectPath: string, maxMutants: number, scope?: TestScope): Promise<MutationScoreReport>
  getLastReport(projectPath: string): Promise<RunReport | null>

  /** [AI] 요구사항 항목별 구현/테스트검증 여부 감사 → 완료율 + gap 리포트 (브라우저 불필요) */
  auditCoverage(
    projectPath: string,
    requirementName: string,
    kind: CoverageKind
  ): Promise<CoverageReport>
  /** 저장된 커버리지 리포트들 */
  getCoverageReports(projectPath: string): Promise<CoverageReport[]>

  /** [무거움] production 빌드 + nextcov 로 서버+클라 코드 라인 커버리지 측정 */
  runCodeCoverage(projectPath: string): Promise<CodeCoverageReport>
  getCodeCoverage(projectPath: string): Promise<CodeCoverageReport | null>
  /** [흐름 기반 루프] 측정 → gap을 flow로 묶어 flow 테스트 생성 → 목표/한도까지 반복 */
  runCoverageLoop(
    projectPath: string,
    targetPct: number,
    maxIterations: number
  ): Promise<CodeCoverageReport>

  /** [추적성] 요구사항→체크리스트→테스트→실행을 조인한 매트릭스 (결정적, AI 미사용) */
  getTraceability(projectPath: string): Promise<TraceabilityReport>
  /** [변경 영향] 마지막 실행 이후 바뀐 소스 → 영향받는 테스트 (재테스트 필수) */
  getChangeImpact(projectPath: string): Promise<ChangeImpactReport>

  // --- 로그인(auth) ---
  getAuthStatus(projectPath: string): Promise<AuthStatus>
  /** 비밀번호를 safeStorage 로 암호화해 .qa/.auth/ 에 저장 */
  setAuthSecret(projectPath: string, password: string): Promise<AuthStatus>
  /** [AI] 로그인 페이지를 읽어 auth.setup.ts(세션 저장 셋업) 생성 */
  generateAuthSetup(projectPath: string): Promise<AuthStatus>

  /** [AI+결정적] 실패한 테스트의 셀렉터를 AI 가 고치고 재실행 (self-healing) */
  healAndRerun(projectPath: string, only?: string[]): Promise<HealResult>

  /** 진행 상황 구독. 반환된 함수 호출 시 해제 */
  onProgress(cb: (e: ProgressEvent) => void): () => void
}
