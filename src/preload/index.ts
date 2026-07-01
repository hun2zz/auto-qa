import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC, type AutoQaApi, type ProgressEvent } from '@shared/types'

const api: AutoQaApi = {
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  getLastProject: () => ipcRenderer.invoke(IPC.getLastProject),
  getRecentProjects: () => ipcRenderer.invoke(IPC.getRecentProjects),
  reopenProject: (path) => ipcRenderer.invoke(IPC.reopenProject, path),
  resetProject: (p) => ipcRenderer.invoke(IPC.resetProject, p),
  analyzeSeed: (p) => ipcRenderer.invoke(IPC.analyzeSeed, p),
  generateSeed: (p) => ipcRenderer.invoke(IPC.generateSeed, p),
  getKnownWorld: (p) => ipcRenderer.invoke(IPC.getKnownWorld, p),
  saveKnownWorld: (p, content) => ipcRenderer.invoke(IPC.saveKnownWorld, p, content),
  getConfig: (p) => ipcRenderer.invoke(IPC.getConfig, p),
  saveConfig: (p, c) => ipcRenderer.invoke(IPC.saveConfig, p, c),
  listRules: (p) => ipcRenderer.invoke(IPC.listRules, p),
  saveRule: (p, name, content) => ipcRenderer.invoke(IPC.saveRule, p, name, content),

  listRequirements: (p) => ipcRenderer.invoke(IPC.listRequirements, p),
  uploadRequirement: (p) => ipcRenderer.invoke(IPC.uploadRequirement, p),
  addRequirementText: (p, title, content) =>
    ipcRenderer.invoke(IPC.addRequirementText, p, title, content),

  generateChecklist: (p, r) => ipcRenderer.invoke(IPC.generateChecklist, p, r),
  listChecklists: (p) => ipcRenderer.invoke(IPC.listChecklists, p),
  saveChecklist: (p, id, md) => ipcRenderer.invoke(IPC.saveChecklist, p, id, md),
  approveChecklist: (p, id) => ipcRenderer.invoke(IPC.approveChecklist, p, id),
  approveAllChecklists: (p) => ipcRenderer.invoke(IPC.approveAllChecklists, p),

  generateTests: (p, id) => ipcRenderer.invoke(IPC.generateTests, p, id),
  generateAllTests: (p) => ipcRenderer.invoke(IPC.generateAllTests, p),
  generateCodeTests: (p) => ipcRenderer.invoke(IPC.generateCodeTests, p),
  listTestFiles: (p) => ipcRenderer.invoke(IPC.listTestFiles, p),
  analyzeAssertions: (p, scope) => ipcRenderer.invoke(IPC.analyzeAssertions, p, scope),
  strengthenLoop: (p, t, m, scope) => ipcRenderer.invoke(IPC.strengthenLoop, p, t, m, scope),
  runEval: (p, scope) => ipcRenderer.invoke(IPC.runEval, p, scope),
  rebuildIndex: (p) => ipcRenderer.invoke(IPC.rebuildIndex, p),
  validateSelectors: (p, scope) => ipcRenderer.invoke(IPC.validateSelectors, p, scope),

  runTests: (p, only) => ipcRenderer.invoke(IPC.runTests, p, only),
  runFailedTests: (p) => ipcRenderer.invoke(IPC.runFailedTests, p),
  cancelRun: (p) => ipcRenderer.invoke(IPC.cancelRun, p),
  negativeControl: (p, scope) => ipcRenderer.invoke(IPC.negativeControl, p, scope),
  getLastReport: (p) => ipcRenderer.invoke(IPC.getLastReport, p),
  getTraceability: (p) => ipcRenderer.invoke(IPC.getTraceability, p),

  auditCoverage: (p, requirementName, kind) =>
    ipcRenderer.invoke(IPC.auditCoverage, p, requirementName, kind),
  getCoverageReports: (p) => ipcRenderer.invoke(IPC.getCoverageReports, p),
  runCodeCoverage: (p) => ipcRenderer.invoke(IPC.runCodeCoverage, p),
  getCodeCoverage: (p) => ipcRenderer.invoke(IPC.getCodeCoverage, p),
  runCoverageLoop: (p, targetPct, maxIterations) =>
    ipcRenderer.invoke(IPC.runCoverageLoop, p, targetPct, maxIterations),

  getAuthStatus: (p) => ipcRenderer.invoke(IPC.getAuthStatus, p),
  setAuthSecret: (p, password) => ipcRenderer.invoke(IPC.setAuthSecret, p, password),
  generateAuthSetup: (p) => ipcRenderer.invoke(IPC.generateAuthSetup, p),

  healAndRerun: (p, only) => ipcRenderer.invoke(IPC.healAndRerun, p, only),

  onProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: ProgressEvent): void => cb(payload)
    ipcRenderer.on(IPC.progress, listener)
    return () => ipcRenderer.removeListener(IPC.progress, listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (no contextIsolation)
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
