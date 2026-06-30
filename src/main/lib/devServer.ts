import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ProgressEvent } from '@shared/types'
import { loadProjectEnv } from './dotenv'

/** 타겟 앱 dev 서버를 구동하고 readyUrl 이 응답할 때까지 대기 */
export interface DevServerHandle {
  stop: () => void
  /** 실제로 서버가 응답한 주소 (포트가 바뀌었으면 그 포트). 테스트 baseURL 로 사용. */
  baseURL: string
}

/** readyUrl 의 포트만 새 포트로 교체 */
function withPort(baseUrl: string, port: string): string {
  try {
    const u = new URL(baseUrl)
    u.port = port
    return u.origin
  } catch {
    return `http://localhost:${port}`
  }
}

export async function startDevServer(args: {
  projectPath: string
  devCommand: string
  readyUrl: string
  readyTimeoutMs: number
  onProgress: (e: ProgressEvent) => void
}): Promise<DevServerHandle> {
  const { projectPath, devCommand, readyUrl, readyTimeoutMs, onProgress } = args

  // 이미 떠 있는 dev 서버가 있으면 재사용한다. (우리가 띄운 게 아니므로 stop 은 no-op)
  // → 사용자가 직접 띄운 서버나 직전 실행의 서버와 포트 충돌하는 것을 방지.
  if (await isUp(readyUrl)) {
    onProgress({ phase: 'devserver', message: `이미 실행 중인 서버 재사용: ${readyUrl} ✓`, done: true })
    return { stop: () => {}, baseURL: readyUrl }
  }

  // 의존성 미설치 빠른 진단 — 없으면 'next: command not found (code 127)' 대신 명확한 안내.
  if (!existsSync(join(projectPath, 'node_modules'))) {
    throw new Error(
      `의존성이 설치되지 않았습니다 (node_modules 없음).\n프로젝트 폴더에서 'npm install' 을 먼저 실행하세요:\n  ${projectPath}`
    )
  }

  onProgress({ phase: 'devserver', message: `dev 서버 시작: ${devCommand}` })

  // 셸로 실행(예: "npm run dev"). detached 로 프로세스 그룹을 만들어 트리 전체를 종료 가능하게.
  const child: ChildProcess = spawn(devCommand, {
    cwd: projectPath,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...loadProjectEnv(projectPath) },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let tail = '' // 진단용 최근 출력 누적
  let detectedUrl: string | null = null // dev 서버가 실제로 띄운 주소(포트 바뀜 감지)
  const sniff = (d: string): void => {
    // Next: "using available port 3001 instead." / "- Local: http://localhost:3001"
    const shift = d.match(/available port (\d+)/i)
    const local = d.match(/Local:\s*https?:\/\/[^\s:]+:(\d+)/i)
    const generic = d.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i)
    const port = shift?.[1] ?? local?.[1] ?? generic?.[1]
    if (port) detectedUrl = withPort(readyUrl, port)
  }
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (d: string) => {
    tail = (tail + d).slice(-2000)
    sniff(d)
    onProgress({ phase: 'devserver', message: 'dev 서버 구동 중…', log: d.trimEnd() })
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (d: string) => {
    tail = (tail + d).slice(-2000)
    sniff(d)
    onProgress({ phase: 'devserver', message: 'dev 서버 구동 중…', log: d.trimEnd() })
  })

  const stop = (): void => {
    if (child.pid == null) return
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'])
      } else {
        process.kill(-child.pid, 'SIGTERM') // 프로세스 그룹 종료
      }
    } catch {
      /* 이미 종료됨 */
    }
  }

  const deadline = Date.now() + readyTimeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const code = child.exitCode
      // 127 / command not found = 바이너리(next 등) 미설치 → 의존성 안내
      const missingBin = code === 127 || /command not found|not recognized/i.test(tail)
      const hint = missingBin
        ? ` 실행 파일을 찾지 못했습니다 — '${projectPath}' 에서 'npm install' 을 했는지 확인하세요.`
        : ' devCommand 를 확인하세요.'
      throw new Error(`dev 서버가 조기 종료됨 (code ${code}).${hint}`)
    }
    // 실제 띄운 주소(포트 바뀜)를 우선 검사, 없으면 설정된 readyUrl.
    const target = detectedUrl ?? readyUrl
    if (await isUp(target)) {
      const note = target !== readyUrl ? ` (포트 변경 감지: ${target})` : ''
      onProgress({ phase: 'devserver', message: `서버 준비 완료 ✓${note}`, done: true })
      return { stop, baseURL: target }
    }
    await delay(700)
  }

  stop()
  const tried = detectedUrl && detectedUrl !== readyUrl ? `${readyUrl} → 감지된 ${detectedUrl}` : readyUrl
  throw new Error(
    `서버 준비 대기 시간 초과 (${tried}, ${readyTimeoutMs}ms). 포트가 점유돼 다른 포트로 떴거나, readyUrl/타임아웃을 확인하세요.`
  )
}

async function isUp(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    return res.status < 500
  } catch {
    return false
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
