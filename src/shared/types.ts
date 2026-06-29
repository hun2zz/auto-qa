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
  runTests: 'tests:run',
  getLastReport: 'report:last',
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
export interface HealResult {
  /** 수정 시도한 spec 파일 수 */
  attempted: number
  /** AI 가 실제로 고친 spec 파일 수 */
  healed: number
  /** 재실행 후 리포트 */
  report: RunReport
  /** 고친 항목 요약 */
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

  /** [결정적] dev 서버 구동 → playwright 실행 → 리포트. only 지정 시 해당 spec 만 */
  runTests(projectPath: string, only?: string): Promise<RunReport>
  getLastReport(projectPath: string): Promise<RunReport | null>

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
