import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { AuthStatus, QaConfig } from '@shared/types'
import { getConfig, qaDir } from './projectManager'

// auth.setup.ts 가 읽는 환경변수 이름 (런너가 주입). 비밀번호는 AI 에 노출되지 않음.
export const AUTH_ENV = {
  user: 'QA_USER',
  password: 'QA_PASSWORD',
  loginUrl: 'QA_LOGIN_URL'
} as const

const authDir = (p: string): string => join(qaDir(p), '.auth')
const secretPath = (p: string): string => join(authDir(p), 'secret.bin')
const statePath = (p: string): string => join(authDir(p), 'state.json')
export const setupSpecPath = (p: string): string => join(qaDir(p), 'tests', 'auth.setup.ts')
/** playwright.config 에서 쓰는 storageState 상대경로 (cwd=projectPath 기준) */
export const STORAGE_STATE_REL = '.qa/.auth/state.json'

export async function setAuthSecret(projectPath: string, password: string): Promise<AuthStatus> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 머신에서 암호화 저장(safeStorage)을 사용할 수 없습니다.')
  }
  await fs.mkdir(authDir(projectPath), { recursive: true })
  const enc = safeStorage.encryptString(password)
  await fs.writeFile(secretPath(projectPath), enc)
  return getAuthStatus(projectPath)
}

/** 복호화된 비밀번호 (런너 전용). 없으면 null */
export async function readAuthSecret(projectPath: string): Promise<string | null> {
  if (!existsSync(secretPath(projectPath))) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  const buf = await fs.readFile(secretPath(projectPath))
  return safeStorage.decryptString(buf)
}

export async function getAuthStatus(projectPath: string): Promise<AuthStatus> {
  const config: QaConfig = await getConfig(projectPath)
  return {
    enabled: Boolean(config.auth?.enabled),
    hasSecret: existsSync(secretPath(projectPath)),
    hasSetupSpec: existsSync(setupSpecPath(projectPath)),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

/** 런너가 playwright 에 주입할 auth 환경변수 (auth 미사용/미설정이면 빈 객체) */
export async function authEnv(projectPath: string): Promise<Record<string, string>> {
  const config = await getConfig(projectPath)
  if (!config.auth?.enabled) return {}
  const password = await readAuthSecret(projectPath)
  const env: Record<string, string> = {
    [AUTH_ENV.user]: config.auth.user || '',
    [AUTH_ENV.loginUrl]: config.auth.loginUrl || ''
  }
  if (password) env[AUTH_ENV.password] = password
  return env
}

export { statePath }
