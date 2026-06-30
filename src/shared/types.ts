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

/** CI 스캐폴드 결과 */
export interface CiScaffoldResult {
  written: string[]
  skipped: string[]
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
  scaffoldCI: 'project:scaffoldCI',
  analyzeSeed: 'seed:analyze',
  getKnownWorld: 'seed:get',
  saveKnownWorld: 'seed:save',
  listRequirements: 'req:list',
  uploadRequirement: 'req:upload',
  addRequirementText: 'req:addText',
  generateChecklist: 'checklist:generate',
  listChecklists: 'checklist:list',
  saveChecklist: 'checklist:save',
  approveChecklist: 'checklist:approve',
  approveAllChecklists: 'checklist:approveAll',
  generateTests: 'tests:generate',
  generateAllTests: 'tests:generateAll',
  generateCodeTests: 'tests:generateCode',
  analyzeAssertions: 'tests:assertionStrength',
  runEval: 'tests:eval',
  rebuildIndex: 'index:build',
  validateSelectors: 'index:validate',
  runTests: 'tests:run',
  cancelRun: 'tests:cancel',
  negativeControl: 'tests:negativeControl',
  getLastReport: 'report:last',
  auditCoverage: 'coverage:audit',
  getCoverageReports: 'coverage:list',
  runCodeCoverage: 'coverage:code:run',
  getCodeCoverage: 'coverage:code:get',
  runCoverageLoop: 'coverage:code:loop',
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
  /** CI 게이트 파일(.qa/ci/run.mjs + .github/workflows/qa.yml) 생성 (덮어쓰지 않음) */
  scaffoldCI(projectPath: string): Promise<CiScaffoldResult>

  /** [AI] 프로젝트의 시드 스크립트/스키마를 분석해 'known-world'(시드된 결정적 상태) 문서 생성 + setupCommand 제안. 파괴적 실행 없음 */
  analyzeSeed(projectPath: string): Promise<{ knownWorld: string; suggestedCommand: string }>
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
  /** [정적] 생성된 테스트의 단언 강도 분석 (실행 없음) */
  analyzeAssertions(projectPath: string): Promise<AssertionReport>
  /** [정적] 생성 품질 채점 + 이력 기록 (프롬프트/규칙 변경 전후 비교) */
  runEval(projectPath: string): Promise<EvalResult>
  /** grounding 인덱스 재빌드 (진짜 셀렉터/라우트 추출) */
  rebuildIndex(projectPath: string): Promise<CodeIndex>
  /** 생성된 테스트의 셀렉터를 인덱스로 검증 (지어낸 것 탐지) */
  validateSelectors(projectPath: string): Promise<SelectorValidation>

  /** [결정적] dev 서버 구동 → playwright 실행 → 리포트. only 지정 시 해당 spec 만 */
  runTests(projectPath: string, only?: string): Promise<RunReport>
  /** 진행 중인 runTests 를 중단 (Playwright 종료 + dev 서버 정리) */
  cancelRun(projectPath: string): Promise<void>
  /** [무거움] 통과 테스트의 기대값을 틀리게 변형해 재실행 → 진짜 검증하는지(sensitive) 확인 */
  negativeControl(projectPath: string): Promise<NegativeControlReport>
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

  // --- 로그인(auth) ---
  getAuthStatus(projectPath: string): Promise<AuthStatus>
  /** 비밀번호를 safeStorage 로 암호화해 .qa/.auth/ 에 저장 */
  setAuthSecret(projectPath: string, password: string): Promise<AuthStatus>
  /** [AI] 로그인 페이지를 읽어 auth.setup.ts(세션 저장 셋업) 생성 */
  generateAuthSetup(projectPath: string): Promise<AuthStatus>

  /** [AI+결정적] 실패한 테스트의 셀렉터를 AI 가 고치고 재실행 (self-healing) */
  healAndRerun(projectPath: string): Promise<HealResult>

  /** 진행 상황 구독. 반환된 함수 호출 시 해제 */
  onProgress(cb: (e: ProgressEvent) => void): () => void
}
