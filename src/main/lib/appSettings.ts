import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * 앱 전역 설정(어떤 프로젝트를 열었는지 등)을 OS 의 userData 디렉터리에 저장.
 * 프로젝트별 산출물(.qa/)과 달리, 이건 "이 컴퓨터의 앱 상태"다.
 */
interface AppSettings {
  lastProjectPath?: string
  recentProjects?: string[]
}

const file = (): string => join(app.getPath('userData'), 'auto-qa-settings.json')

async function read(): Promise<AppSettings> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8'))
  } catch {
    return {}
  }
}

async function write(s: AppSettings): Promise<void> {
  await fs.writeFile(file(), JSON.stringify(s, null, 2), 'utf8')
}

/** 프로젝트를 연결할 때 호출 — 마지막/최근 목록 갱신 */
export async function rememberProject(path: string): Promise<void> {
  const s = await read()
  const recent = [path, ...(s.recentProjects ?? []).filter((p) => p !== path)].slice(0, 8)
  await write({ lastProjectPath: path, recentProjects: recent })
}

/** 마지막으로 연 프로젝트 경로 (폴더가 아직 존재할 때만) */
export async function getLastProjectPath(): Promise<string | null> {
  const s = await read()
  if (s.lastProjectPath && existsSync(s.lastProjectPath)) return s.lastProjectPath
  return null
}

/** 최근 프로젝트 목록 (존재하는 폴더만) */
export async function getRecentProjects(): Promise<string[]> {
  const s = await read()
  return (s.recentProjects ?? []).filter((p) => existsSync(p))
}
