import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC, type AutoQaApi, type ProgressEvent } from '@shared/types'

const api: AutoQaApi = {
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  getConfig: (p) => ipcRenderer.invoke(IPC.getConfig, p),
  saveConfig: (p, c) => ipcRenderer.invoke(IPC.saveConfig, p, c),

  listRequirements: (p) => ipcRenderer.invoke(IPC.listRequirements, p),
  uploadRequirement: (p) => ipcRenderer.invoke(IPC.uploadRequirement, p),
  addRequirementText: (p, title, content) =>
    ipcRenderer.invoke(IPC.addRequirementText, p, title, content),

  generateChecklist: (p, r) => ipcRenderer.invoke(IPC.generateChecklist, p, r),
  listChecklists: (p) => ipcRenderer.invoke(IPC.listChecklists, p),
  saveChecklist: (p, id, md) => ipcRenderer.invoke(IPC.saveChecklist, p, id, md),
  approveChecklist: (p, id) => ipcRenderer.invoke(IPC.approveChecklist, p, id),

  generateTests: (p, id) => ipcRenderer.invoke(IPC.generateTests, p, id),

  runTests: (p) => ipcRenderer.invoke(IPC.runTests, p),
  getLastReport: (p) => ipcRenderer.invoke(IPC.getLastReport, p),

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
