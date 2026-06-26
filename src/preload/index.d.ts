import type { ElectronAPI } from '@electron-toolkit/preload'
import type { AutoQaApi } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: AutoQaApi
  }
}
