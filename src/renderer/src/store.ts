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
  HealResult
} from '@shared/types'
import { DEFAULT_QA_CONFIG } from '@shared/types'

/** 파이프라인 단계 식별자 */
export type StepId = 'requirements' | 'checklists' | 'tests' | 'run'

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
  rules: string

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
  refreshAll: () => Promise<void>
  loadConfig: () => Promise<void>
  saveConfig: (config: QaConfig) => Promise<void>
  loadRules: () => Promise<void>
  saveRules: (content: string) => Promise<void>

  uploadRequirement: () => Promise<void>
  addRequirementText: (title: string, content: string) => Promise<boolean>
  refreshRequirements: () => Promise<void>

  generateChecklist: (requirementName: string) => Promise<void>
  refreshChecklists: () => Promise<void>
  saveChecklist: (id: string, markdown: string) => Promise<void>
  approveChecklist: (id: string) => Promise<void>

  generateTests: (checklistId: string) => Promise<void>

  runTests: () => Promise<void>
  loadLastReport: () => Promise<void>

  loadAuthStatus: () => Promise<void>
  setAuthSecret: (password: string) => Promise<void>
  generateAuthSetup: () => Promise<void>
  healAndRerun: () => Promise<void>
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
    rules: '',

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

    refreshAll: async () => {
      const { project } = get()
      if (!project) return
      await Promise.all([
        get().loadConfig(),
        get().loadRules(),
        get().refreshRequirements(),
        get().refreshChecklists(),
        get().loadLastReport(),
        get().loadAuthStatus()
      ])
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
      const rules = await window.api.getRules(project.path).catch(() => '')
      set({ rules })
    },

    saveRules: async (content) => {
      const { project } = get()
      if (!project) return
      await withBusy('saveRules', async () => {
        await window.api.saveRules(project.path, content)
        set({ rules: content })
        get().pushToast('success', 'QA 규칙(RULES.md)이 저장되었습니다')
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

    runTests: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('runTests', async () => {
        const report = await window.api.runTests(project.path)
        set({ lastReport: report })
        if (report.fatalError) {
          get().pushToast('error', '실행 중 치명적 오류가 발생했습니다')
        } else if (report.failed > 0) {
          get().pushToast('info', `테스트 완료 — 실패 ${report.failed}건`)
        } else {
          get().pushToast('success', '모든 테스트를 통과했습니다')
        }
      })
    },

    loadLastReport: async () => {
      const { project } = get()
      if (!project) return
      const lastReport = await window.api.getLastReport(project.path).catch(() => null)
      set({ lastReport })
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

    generateAuthSetup: async () => {
      const { project } = get()
      if (!project) return
      await withBusy('generateAuthSetup', async () => {
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
    }
  }
})

/** busyKey 가 활성인지 구독하는 셀렉터 훅 헬퍼 */
export const isBusy = (key: BusyKey) => (s: AppState): boolean => !!s.busyKeys[key]
