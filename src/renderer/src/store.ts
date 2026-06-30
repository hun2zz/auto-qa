import { create } from 'zustand'
import type {
  ProjectInfo,
  QaConfig,
  RequirementFile,
  Checklist,
  RunReport,
  ProgressEvent,
  ProgressPhase,
  AuthStatus,
  HealResult,
  NegativeControlReport,
  RuleFile,
  CoverageReport,
  CoverageKind,
  CodeCoverageReport,
  AssertionReport,
  SelectorValidation,
  EvalResult,
  TestFile
} from '@shared/types'
import { DEFAULT_QA_CONFIG } from '@shared/types'

/** 파이프라인 단계 식별자 */
export type StepId = 'requirements' | 'checklists' | 'tests' | 'run' | 'coverage'

/** 콘솔에 쌓이는 진행 로그 한 줄 */
export interface LogLine {
  id: number
  phase: ProgressPhase
  message: string
  log?: string
  error?: boolean
  done?: boolean
  at: number
}

/** 토스트 알림 */
export interface Toast {
  id: number
  kind: 'error' | 'info' | 'success'
  text: string
}

/** 특정 비동기 작업 키 (버튼 단위 로딩 상태용) */
export type BusyKey = string

interface AppState {
  // ── 도메인 데이터 ──────────────────────────────────────────────
  project: ProjectInfo | null
  config: QaConfig | null
  requirements: RequirementFile[]
  checklists: Checklist[]
  lastReport: RunReport | null
  authStatus: AuthStatus | null
  lastHeal: HealResult | null
  negativeControl: NegativeControlReport | null
  rules: RuleFile[]
  coverageReports: CoverageReport[]
  codeCoverage: CodeCoverageReport | null

  // ── UI 상태 ────────────────────────────────────────────────────
  activeStep: StepId
  configOpen: boolean
  toasts: Toast[]

  // ── 진행 상황 스트림 ────────────────────────────────────────────
  busy: boolean
  busyKeys: Record<BusyKey, boolean>
  phase: ProgressPhase
  phaseMessage: string
  fraction?: number
  log: LogLine[]
  consoleOpen: boolean

  // ── 액션 ───────────────────────────────────────────────────────
  setActiveStep: (s: StepId) => void
  setConfigOpen: (open: boolean) => void
  toggleConsole: () => void
  dismissToast: (id: number) => void
  pushToast: (kind: Toast['kind'], text: string) => void

  initProgress: () => () => void

  openProject: () => Promise<void>
  restoreLastProject: () => Promise<void>
  resetProject: () => Promise<void>
  refreshAll: () => Promise<void>
  loadConfig: () => Promise<void>
  saveConfig: (config: QaConfig) => Promise<void>
  loadRules: () => Promise<void>
  saveRule: (name: string, content: string) => Promise<void>

  knownWorld: string
  loadKnownWorld: () => Promise<void>
  saveKnownWorld: (content: string) => Promise<void>
  analyzeSeed: () => Promise<string>

  uploadRequirement: () => Promise<void>
  addRequirementText: (title: string, content: string) => Promise<boolean>
  refreshRequirements: () => Promise<void>

  generateChecklist: (requirementName: string) => Promise<void>
  refreshChecklists: () => Promise<void>
  saveChecklist: (id: string, markdown: string) => Promise<void>
  approveChecklist: (id: string) => Promise<void>
  approveAllChecklists: () => Promise<void>

  generateTests: (checklistId: string) => Promise<void>
  generateAllTests: () => Promise<void>
  generateCodeTests: () => Promise<void>
  testFiles: TestFile[]
  loadTestFiles: () => Promise<void>
  assertionReport: AssertionReport | null
  analyzeAssertions: () => Promise<void>
  selectorValidation: SelectorValidation | null
  validateSelectors: () => Promise<void>
  evalResult: EvalResult | null
  runEval: () => Promise<void>

  runTests: (only?: string) => Promise<void>
  runFailedTests: () => Promise<void>
  rerunTest: (file: string | undefined, title: string, line?: number) => Promise<void>
  applyRunResult: (report: RunReport, isRerun?: boolean) => void
  cancelRun: () => Promise<void>
  loadLastReport: () => Promise<void>
  auditCoverage: (requirementName: string, kind: CoverageKind) => Promise<void>
  loadCoverageReports: () => Promise<void>
  runCodeCoverage: () => Promise<void>
  runCoverageLoop: (targetPct: number, maxIterations: number) => Promise<void>
  loadCodeCoverage: () => Promise<void>

  loadAuthStatus: () => Promise<void>
  setAuthSecret: (password: string) => Promise<void>
  generateAuthSetup: (config?: QaConfig) => Promise<void>
  healAndRerun: () => Promise<void>
  runNegativeControl: () => Promise<void>
  scaffoldCI: () => Promise<void>
}

let logSeq = 0
let toastSeq = 0

export const useStore = create<AppState>((set, get) => {
  /** 비동기 액션 공통 래퍼: busyKey 토글 + 에러 토스트 */
  async function withBusy<T>(key: BusyKey, fn: () => Promise<T>): Promise<T | undefined> {
    set((s) => ({ busy: true, busyKeys: { ...s.busyKeys, [key]: true } }))
    try {
      return await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      get().pushToast('error', msg)
      set({
        phase: 'idle',
        phaseMessage: '오류가 발생했습니다'
      })
      return undefined
    } finally {
      set((s) => {
        const busyKeys = { ...s.busyKeys }
        delete busyKeys[key]
        const stillBusy = Object.keys(busyKeys).length > 0
        return { busyKeys, busy: stillBusy }
      })
    }
  }

  return {
    project: null,
    config: null,
    requirements: [],
    checklists: [],
    lastReport: null,
    authStatus: null,
    lastHeal: null,
    negativeControl: null,
    rules: [],
    coverageReports: [],
    codeCoverage: null,
    knownWorld: '',
    assertionReport: null,
    selectorValidation: null,
    evalResult: null,
    testFiles: [],

    activeStep: 'requirements',
    configOpen: false,
    toasts: [],

    busy: false,
    busyKeys: {},
    phase: 'idle',
    phaseMessage: '',
    fraction: undefined,
    log: [],
    consoleOpen: true,

    setActiveStep: (s) => set({ activeStep: s }),
    setConfigOpen: (open) => set({ configOpen: open }),
    toggleConsole: () => set((s) => ({ consoleOpen: !s.consoleOpen })),

    pushToast: (kind, text) =>
      set((s) => ({ toasts: [...s.toasts, { id: ++toastSeq, kind, text }] })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    initProgress: () => {
      return window.api.onProgress((e: ProgressEvent) => {
        set((s) => {
          const line: LogLine = {
            id: ++logSeq,
            phase: e.phase,
            message: e.message,
            log: e.log,
            error: e.error,
            done: e.done,
            at: Date.now()
          }
          const log = [...s.log, line]
          // 콘솔이 무한히 커지지 않도록 최근 500줄만 유지
          if (log.length > 500) log.splice(0, log.length - 500)
          return {
            log,
            phase: e.phase,
            phaseMessage: e.message,
            fraction: e.fraction
          }
        })
      })
    },

    openProject: async () => {
      await withBusy('openProject', async () => {
        const project = await window.api.openProject()
        if (!project) return
        set({
          project,
          requirements: [],
          checklists: [],
          lastReport: null,
          authStatus: null,
          lastHeal: null,
          config: null,
          activeStep: 'requirements'
        })
        await get().refreshAll()
        await get().loadAuthStatus()
        get().pushToast('success', `'${project.name}' 프로젝트에 연결되었습니다`)
      })
    },

    restoreLastProject: async () => {
      // 앱 시작 시 마지막으로 연 프로젝트를 조용히 자동 재연결
      const project = await window.api.getLastProject().catch(() => null)
      if (!project) return
      set({
        project,
        requirements: [],
        checklists: [],
        lastReport: null,
        authStatus: null,
        lastHeal: null,
        config: null,
        activeStep: 'requirements'
      })
      await get().refreshAll()
    },

    resetProject: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('resetProject', async () => {
        const scope = await window.api.resetProject(project.path)
        if (scope === 'cancel') return
        set({ codeCoverage: null, lastReport: null, lastHeal: null, coverageReports: [] })
        await get().refreshAll()
        get().setActiveStep('requirements')
        get().pushToast('success', scope === 'all' ? '전체 초기화 완료' : '생성물 초기화 완료')
      })
    },

    refreshAll: async () => {
      const { project } = get()
      if (!project) return
      await Promise.all([
        get().loadConfig(),
        get().loadRules(),
        get().refreshRequirements(),
        get().refreshChecklists(),
        get().loadLastReport(),
        get().loadAuthStatus(),
        get().loadCoverageReports(),
        get().loadCodeCoverage(),
        get().loadKnownWorld(),
        get().loadTestFiles()
      ])
    },

    loadTestFiles: async () => {
      const { project } = get()
      if (!project) return
      const testFiles = await window.api.listTestFiles(project.path).catch(() => [])
      set({ testFiles })
    },

    loadConfig: async () => {
      const { project } = get()
      if (!project) return
      const config = await window.api.getConfig(project.path).catch(() => DEFAULT_QA_CONFIG)
      set({ config })
    },

    saveConfig: async (config) => {
      const { project } = get()
      if (!project) return
      await withBusy('saveConfig', async () => {
        await window.api.saveConfig(project.path, config)
        set({ config, configOpen: false })
        get().pushToast('success', '설정이 저장되었습니다')
      })
    },

    loadRules: async () => {
      const { project } = get()
      if (!project) return
      const rules = await window.api.listRules(project.path).catch(() => [])
      set({ rules })
    },

    loadKnownWorld: async () => {
      const { project } = get()
      if (!project) return
      const knownWorld = await window.api.getKnownWorld(project.path).catch(() => '')
      set({ knownWorld })
    },

    saveKnownWorld: async (content) => {
      const { project } = get()
      if (!project) return
      await withBusy('saveKnownWorld', async () => {
        await window.api.saveKnownWorld(project.path, content)
        set({ knownWorld: content })
        get().pushToast('success', 'known-world 저장됨')
      })
    },

    analyzeSeed: async () => {
      const { project } = get()
      if (!project) return ''
      let suggested = ''
      await withBusy('analyzeSeed', async () => {
        const res = await window.api.analyzeSeed(project.path)
        set({ knownWorld: res.knownWorld })
        suggested = res.suggestedCommand
        get().pushToast('success', '시드 분석 완료 — known-world 생성됨')
      })
      return suggested
    },

    saveRule: async (name, content) => {
      const { project } = get()
      if (!project) return
      await withBusy('saveRule', async () => {
        await window.api.saveRule(project.path, name, content)
        await get().loadRules()
        get().pushToast('success', `규칙 '${name}' 저장됨`)
      })
    },

    refreshRequirements: async () => {
      const { project } = get()
      if (!project) return
      const requirements = await window.api.listRequirements(project.path)
      set({ requirements })
    },

    uploadRequirement: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('uploadRequirement', async () => {
        const file = await window.api.uploadRequirement(project.path)
        if (!file) return
        await get().refreshRequirements()
        get().pushToast('success', `'${file.name}' 업로드 완료`)
      })
    },

    addRequirementText: async (title, content) => {
      const { project } = get()
      if (!project) return false
      let ok = false
      await withBusy('addRequirementText', async () => {
        const file = await window.api.addRequirementText(project.path, title, content)
        await get().refreshRequirements()
        get().pushToast('success', `'${file.name}' 추가 완료`)
        ok = true
      })
      return ok
    },

    refreshChecklists: async () => {
      const { project } = get()
      if (!project) return
      const checklists = await window.api.listChecklists(project.path)
      set({ checklists })
    },

    generateChecklist: async (requirementName) => {
      const { project } = get()
      if (!project) return
      await withBusy(`checklist:${requirementName}`, async () => {
        await window.api.generateChecklist(project.path, requirementName)
        await get().refreshChecklists()
        get().pushToast('success', '체크리스트가 생성되었습니다')
      })
    },

    saveChecklist: async (id, markdown) => {
      const { project } = get()
      if (!project) return
      await withBusy(`saveChecklist:${id}`, async () => {
        await window.api.saveChecklist(project.path, id, markdown)
        // 로컬 상태 즉시 반영
        set((s) => ({
          checklists: s.checklists.map((c) => (c.id === id ? { ...c, markdown } : c))
        }))
      })
    },

    approveChecklist: async (id) => {
      const { project } = get()
      if (!project) return
      await withBusy(`approve:${id}`, async () => {
        const updated = await window.api.approveChecklist(project.path, id)
        set((s) => ({
          checklists: s.checklists.map((c) => (c.id === id ? updated : c))
        }))
        get().pushToast('success', '체크리스트가 승인되었습니다')
      })
    },

    approveAllChecklists: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('approveAll', async () => {
        const checklists = await window.api.approveAllChecklists(project.path)
        set({ checklists })
        get().pushToast('success', '모든 체크리스트를 승인했습니다')
      })
    },

    generateTests: async (checklistId) => {
      const { project } = get()
      if (!project) return
      await withBusy(`tests:${checklistId}`, async () => {
        const updated = await window.api.generateTests(project.path, checklistId)
        set((s) => ({
          checklists: s.checklists.map((c) => (c.id === checklistId ? updated : c))
        }))
        get().pushToast('success', '테스트 코드가 생성되었습니다')
      })
    },

    generateAllTests: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('generateAllTests', async () => {
        const checklists = await window.api.generateAllTests(project.path)
        set({ checklists })
        await get().loadTestFiles()
        get().pushToast('success', '테스트 일괄 생성 완료')
      })
    },

    generateCodeTests: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('generateCodeTests', async () => {
        const n = await window.api.generateCodeTests(project.path)
        await get().loadTestFiles()
        get().pushToast('success', `코드 기준 테스트 ${n}개 파일 생성 (회귀·커버리지)`)
      })
    },

    analyzeAssertions: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('analyzeAssertions', async () => {
        const assertionReport = await window.api.analyzeAssertions(project.path)
        set({ assertionReport })
        get().pushToast(
          assertionReport.vacuous > 0 ? 'info' : 'success',
          `단언 강도 ${assertionReport.strengthPct}% · 공허 ${assertionReport.vacuous} · 약함 ${assertionReport.weak}`
        )
      })
    },

    validateSelectors: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('validateSelectors', async () => {
        const selectorValidation = await window.api.validateSelectors(project.path)
        set({ selectorValidation })
        const n = selectorValidation.invented.length
        get().pushToast(
          n > 0 ? 'error' : 'success',
          n > 0 ? `지어낸 셀렉터 의심 ${n}개 발견` : '지어낸 셀렉터 없음 ✓'
        )
      })
    },

    runEval: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('runEval', async () => {
        const evalResult = await window.api.runEval(project.path)
        set({ evalResult })
        const { current, prev } = evalResult
        const delta = prev ? current.strengthPct - prev.strengthPct : null
        const arrow = delta === null ? '' : delta > 0 ? ` (▲${delta})` : delta < 0 ? ` (▼${-delta})` : ' (=)'
        get().pushToast(
          delta !== null && delta < 0 ? 'error' : 'success',
          `생성 점수: 강한단언 ${current.strengthPct}%${arrow} · 공허 ${current.vacuous} · 환각셀렉터 ${current.inventedSelectors}`
        )
      })
    },

    applyRunResult: (report, isRerun = false) => {
      // 부팅/조기 실패(결과 0건)면 직전 결과를 화면에 유지하고 에러만 알린다.
      if (report.fatalError && report.total === 0) {
        get().pushToast(
          report.fatalError.includes('중단') ? 'info' : 'error',
          report.fatalError.includes('중단') ? '실행을 중단했습니다' : `실행 실패: ${report.fatalError}`
        )
        return
      }
      set({ lastReport: report })
      if (report.fatalError) {
        get().pushToast('error', '실행 중 일부 오류가 발생했습니다')
      } else if (report.failed > 0) {
        get().pushToast('info', `${isRerun ? '재실행 완료 — 아직' : '테스트 완료 — '} 실패 ${report.failed}건`)
      } else {
        get().pushToast('success', isRerun ? '재실행한 테스트를 모두 통과했습니다' : '모든 테스트를 통과했습니다')
      }
    },

    runTests: async (only) => {
      const { project } = get()
      if (!project) return
      await withBusy('runTests', async () => {
        const report = await window.api.runTests(project.path, only)
        get().applyRunResult(report)
      })
    },

    runFailedTests: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('runTests', async () => {
        const report = await window.api.runFailedTests(project.path)
        get().applyRunResult(report, true)
      })
    },

    rerunTest: async (file, title, line) => {
      const { project } = get()
      if (!project || !file) return
      const target = line ? `${file}:${line}` : file
      await withBusy(`rerun:${file}::${title}`, async () => {
        const report = await window.api.runTests(project.path, target)
        if (report.fatalError && report.total === 0) {
          get().pushToast('error', `재실행 실패: ${report.fatalError}`)
          return
        }
        set({ lastReport: report }) // 백엔드에서 이전 리포트에 병합된 전체
        const me = report.results.find((r) => r.file === file && r.title === title)
        const passed = me?.status === 'passed'
        get().pushToast(
          passed ? 'success' : 'info',
          `재실행: ${title.slice(0, 40)} → ${passed ? '통과 ✓' : me?.status === 'skipped' ? '스킵' : '실패'}`
        )
      })
    },

    cancelRun: async () => {
      const { project } = get()
      if (!project) return
      await window.api.cancelRun(project.path)
      get().pushToast('info', '실행 중단 요청됨…')
    },

    loadLastReport: async () => {
      const { project } = get()
      if (!project) return
      const lastReport = await window.api.getLastReport(project.path).catch(() => null)
      set({ lastReport })
    },

    loadCoverageReports: async () => {
      const { project } = get()
      if (!project) return
      const coverageReports = await window.api.getCoverageReports(project.path).catch(() => [])
      set({ coverageReports })
    },

    loadCodeCoverage: async () => {
      const { project } = get()
      if (!project) return
      const codeCoverage = await window.api.getCodeCoverage(project.path).catch(() => null)
      set({ codeCoverage })
    },

    runCodeCoverage: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('runCodeCoverage', async () => {
        const codeCoverage = await window.api.runCodeCoverage(project.path)
        set({ codeCoverage })
        if (codeCoverage.fatalError) get().pushToast('error', `코드 커버리지 실패: ${codeCoverage.fatalError}`)
        else get().pushToast('success', `코드 커버리지 — 라인 ${codeCoverage.lines.pct}%`)
      })
    },

    runCoverageLoop: async (targetPct, maxIterations) => {
      const { project } = get()
      if (!project) return
      await withBusy('runCoverageLoop', async () => {
        const codeCoverage = await window.api.runCoverageLoop(project.path, targetPct, maxIterations)
        set({ codeCoverage })
        if (codeCoverage.fatalError)
          get().pushToast('error', `커버리지 루프 실패: ${codeCoverage.fatalError}`)
        else get().pushToast('success', `커버리지 루프 완료 — 라인 ${codeCoverage.lines.pct}%`)
      })
    },

    auditCoverage: async (requirementName, kind) => {
      const { project } = get()
      if (!project) return
      await withBusy(`audit:${kind}:${requirementName}`, async () => {
        const report = await window.api.auditCoverage(project.path, requirementName, kind)
        set((s) => ({
          coverageReports: [
            ...s.coverageReports.filter(
              (r) => !(r.requirementName === requirementName && r.kind === kind)
            ),
            report
          ]
        }))
        const label = kind === 'test' ? '테스트 커버리지' : '구현 감사'
        get().pushToast('success', `${label} 완료 — ${Math.round(report.completionRate * 100)}%`)
      })
    },

    loadAuthStatus: async () => {
      const { project } = get()
      if (!project) return
      const authStatus = await window.api.getAuthStatus(project.path).catch(() => null)
      set({ authStatus })
    },

    setAuthSecret: async (password) => {
      const { project } = get()
      if (!project) return
      await withBusy('setAuthSecret', async () => {
        const authStatus = await window.api.setAuthSecret(project.path, password)
        set({ authStatus })
        get().pushToast('success', '비밀번호가 안전하게 저장되었습니다')
      })
    },

    generateAuthSetup: async (config) => {
      const { project } = get()
      if (!project) return
      await withBusy('generateAuthSetup', async () => {
        // 폼 값이 아직 미저장일 수 있으므로 셋업 생성 전에 config 를 먼저 반영
        if (config) {
          await window.api.saveConfig(project.path, config)
          set({ config })
        }
        const authStatus = await window.api.generateAuthSetup(project.path)
        set({ authStatus })
        get().pushToast('success', '로그인 셋업이 생성되었습니다')
      })
    },

    healAndRerun: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('healAndRerun', async () => {
        const result = await window.api.healAndRerun(project.path)
        set({ lastReport: result.report, lastHeal: result })
        if (result.healed > 0) {
          get().pushToast('success', `AI가 ${result.healed}개 수정 후 재실행했습니다`)
        } else if (result.attempted > 0) {
          get().pushToast('info', '자동 수정할 수 있는 항목이 없었습니다')
        } else {
          get().pushToast('info', '실패한 테스트가 없습니다')
        }
      })
    },

    scaffoldCI: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('scaffoldCI', async () => {
        const r = await window.api.scaffoldCI(project.path)
        get().pushToast(
          'success',
          r.written.length
            ? `CI 파일 생성: ${r.written.join(', ')}`
            : `이미 존재 (건너뜀: ${r.skipped.join(', ')})`
        )
      })
    },

    runNegativeControl: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('negativeControl', async () => {
        const negativeControl = await window.api.negativeControl(project.path)
        set({ negativeControl })
        if (negativeControl.fatalError) {
          get().pushToast('error', `검증 실패: ${negativeControl.fatalError}`)
        } else {
          get().pushToast(
            negativeControl.vacuous > 0 ? 'error' : 'success',
            `진짜 검증 ${negativeControl.sensitive} · 알맹이없음 ${negativeControl.vacuous}`
          )
        }
      })
    }
  }
})

/** busyKey 가 활성인지 구독하는 셀렉터 훅 헬퍼 */
export const isBusy = (key: BusyKey) => (s: AppState): boolean => !!s.busyKeys[key]
