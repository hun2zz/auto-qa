import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type ProgressEvent } from '@shared/types'
import {
  addRequirementText,
  analyzeAssertions,
  analyzeSeed,
  approveAllChecklists,
  approveChecklist,
  auditCoverage,
  connectProject,
  getKnownWorld,
  saveKnownWorld,
  getCoverageReports,
  generateAllTests,
  generateAuthSetup,
  generateChecklist,
  generateCodeTests,
  generateTests,
  getConfig,
  resetProject,
  runEval,
  importRequirement,
  listChecklists,
  listRequirements,
  saveChecklist,
  saveConfig
} from './lib/projectManager'
import { listRules, saveRule } from './lib/rules'
import { getLastProjectPath, getRecentProjects, rememberProject } from './lib/appSettings'
import { existsSync } from 'node:fs'
import { cancelRun, getLastReport, healAndRerun, negativeControl, runTests } from './lib/runner'
import { getAuthStatus, setAuthSecret } from './lib/auth'
import { getCodeCoverage, runCodeCoverage, runCoverageLoop } from './lib/codeCoverage'
import { buildIndex, validateSelectors } from './lib/codeIndex'
import { scaffoldCI } from './lib/ciScaffold'

/** 진행 이벤트를 호출한 창으로 전달 */
function progressSender(e: Electron.IpcMainInvokeEvent): (p: ProgressEvent) => void {
  const win = BrowserWindow.fromWebContents(e.sender)
  return (p: ProgressEvent) => win?.webContents.send(IPC.progress, p)
}

export function registerIpc(): void {
  ipcMain.handle(IPC.openProject, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, {
      title: 'QA 할 프로젝트 폴더 선택',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const info = await connectProject(res.filePaths[0])
    await rememberProject(info.path)
    return info
  })

  ipcMain.handle(IPC.getLastProject, async () => {
    const path = await getLastProjectPath()
    if (!path) return null
    const info = await connectProject(path)
    await rememberProject(info.path)
    return info
  })

  ipcMain.handle(IPC.getRecentProjects, () => getRecentProjects())

  ipcMain.handle(IPC.reopenProject, async (_e, path: string) => {
    if (!existsSync(path)) return null
    const info = await connectProject(path)
    await rememberProject(info.path)
    return info
  })

  ipcMain.handle(IPC.getConfig, (_e, projectPath: string) => getConfig(projectPath))
  ipcMain.handle(IPC.saveConfig, (_e, projectPath: string, config) => saveConfig(projectPath, config))
  ipcMain.handle(IPC.analyzeSeed, (e, projectPath: string) =>
    analyzeSeed(projectPath, progressSender(e))
  )
  ipcMain.handle(IPC.getKnownWorld, (_e, projectPath: string) => getKnownWorld(projectPath))
  ipcMain.handle(IPC.saveKnownWorld, (_e, projectPath: string, content: string) =>
    saveKnownWorld(projectPath, content)
  )

  ipcMain.handle(IPC.listRules, (_e, projectPath: string) => listRules(projectPath))
  ipcMain.handle(IPC.saveRule, (_e, projectPath: string, name: string, content: string) =>
    saveRule(projectPath, name, content)
  )

  ipcMain.handle(IPC.scaffoldCI, (_e, projectPath: string) => scaffoldCI(projectPath))

  ipcMain.handle(IPC.resetProject, async (e, projectPath: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showMessageBox(win, {
      type: 'warning',
      title: '데이터 초기화',
      message: '생성된 데이터를 삭제할까요?',
      detail:
        '· 생성물만: 체크리스트·테스트·리포트·커버리지 삭제 (요구사항/설정/규칙/로그인 유지)\n· 전체: 위 + 요구사항·의도까지 삭제',
      buttons: ['취소', '생성물만 삭제', '전체 삭제'],
      defaultId: 0,
      cancelId: 0
    })
    if (res.response === 0) return 'cancel'
    const scope = res.response === 2 ? 'all' : 'generated'
    await resetProject(projectPath, scope)
    return scope
  })

  ipcMain.handle(IPC.listRequirements, (_e, projectPath: string) => listRequirements(projectPath))

  ipcMain.handle(IPC.uploadRequirement, async (e, projectPath: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const res = await dialog.showOpenDialog(win, {
      title: '요구사항 문서 선택 (문서 / PDF / 가이드 화면 이미지)',
      properties: ['openFile'],
      filters: [
        {
          name: '요구사항',
          extensions: ['md', 'markdown', 'txt', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'csv', 'json']
        },
        { name: '전체', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return importRequirement(projectPath, res.filePaths[0])
  })

  ipcMain.handle(IPC.addRequirementText, (_e, projectPath: string, title: string, content: string) =>
    addRequirementText(projectPath, title, content)
  )

  ipcMain.handle(IPC.generateChecklist, (e, projectPath: string, requirementName: string) =>
    generateChecklist(projectPath, requirementName, progressSender(e))
  )
  ipcMain.handle(IPC.listChecklists, (_e, projectPath: string) => listChecklists(projectPath))
  ipcMain.handle(IPC.saveChecklist, (_e, projectPath: string, id: string, markdown: string) =>
    saveChecklist(projectPath, id, markdown)
  )
  ipcMain.handle(IPC.approveChecklist, (_e, projectPath: string, id: string) =>
    approveChecklist(projectPath, id)
  )
  ipcMain.handle(IPC.approveAllChecklists, (_e, projectPath: string) =>
    approveAllChecklists(projectPath)
  )

  ipcMain.handle(IPC.generateTests, async (e, projectPath: string, checklistId: string) => {
    const config = await getConfig(projectPath)
    return generateTests(projectPath, checklistId, config.baseURL, progressSender(e))
  })
  ipcMain.handle(IPC.generateAllTests, async (e, projectPath: string) => {
    const config = await getConfig(projectPath)
    return generateAllTests(projectPath, config.baseURL, progressSender(e))
  })
  ipcMain.handle(IPC.analyzeAssertions, (_e, projectPath: string) =>
    analyzeAssertions(projectPath)
  )
  ipcMain.handle(IPC.rebuildIndex, (_e, projectPath: string) => buildIndex(projectPath))
  ipcMain.handle(IPC.validateSelectors, (_e, projectPath: string) => validateSelectors(projectPath))
  ipcMain.handle(IPC.runEval, (_e, projectPath: string) => runEval(projectPath))
  ipcMain.handle(IPC.generateCodeTests, (e, projectPath: string) =>
    generateCodeTests(projectPath, progressSender(e))
  )

  ipcMain.handle(IPC.runTests, (e, projectPath: string, only?: string) =>
    runTests(projectPath, progressSender(e), only)
  )
  ipcMain.handle(IPC.cancelRun, (_e, projectPath: string) => cancelRun(projectPath))
  ipcMain.handle(IPC.negativeControl, (e, projectPath: string) =>
    negativeControl(projectPath, progressSender(e))
  )

  ipcMain.handle(
    IPC.auditCoverage,
    (e, projectPath: string, requirementName: string, kind: 'implementation' | 'test') =>
      auditCoverage(projectPath, requirementName, kind, progressSender(e))
  )
  ipcMain.handle(IPC.getCoverageReports, (_e, projectPath: string) =>
    getCoverageReports(projectPath)
  )

  ipcMain.handle(IPC.runCodeCoverage, async (e, projectPath: string) => {
    const config = await getConfig(projectPath)
    return runCodeCoverage(projectPath, config.baseURL, progressSender(e))
  })
  ipcMain.handle(IPC.getCodeCoverage, (_e, projectPath: string) => getCodeCoverage(projectPath))
  ipcMain.handle(
    IPC.runCoverageLoop,
    async (e, projectPath: string, targetPct: number, maxIterations: number) => {
      const config = await getConfig(projectPath)
      return runCoverageLoop(projectPath, config.baseURL, targetPct, maxIterations, progressSender(e))
    }
  )
  ipcMain.handle(IPC.getLastReport, (_e, projectPath: string) => getLastReport(projectPath))

  // auth
  ipcMain.handle(IPC.getAuthStatus, (_e, projectPath: string) => getAuthStatus(projectPath))
  ipcMain.handle(IPC.setAuthSecret, (_e, projectPath: string, password: string) =>
    setAuthSecret(projectPath, password)
  )
  ipcMain.handle(IPC.generateAuthSetup, async (e, projectPath: string) => {
    await generateAuthSetup(projectPath, progressSender(e))
    return getAuthStatus(projectPath)
  })

  // self-healing
  ipcMain.handle(IPC.healAndRerun, (e, projectPath: string) =>
    healAndRerun(projectPath, progressSender(e))
  )
}
