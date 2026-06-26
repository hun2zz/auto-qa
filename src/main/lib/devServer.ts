import { spawn, type ChildProcess } from 'node:child_process'
import type { ProgressEvent } from '@shared/types'

/** 타겟 앱 dev 서버를 구동하고 readyUrl 이 응답할 때까지 대기 */
export interface DevServerHandle {
  stop: () => void
}

export async function startDevServer(args: {
  projectPath: string
  devCommand: string
  readyUrl: string
  readyTimeoutMs: number
  onProgress: (e: ProgressEvent) => void
}): Promise<DevServerHandle> {
  const { projectPath, devCommand, readyUrl, readyTimeoutMs, onProgress } = args

  onProgress({ phase: 'devserver', message: `dev 서버 시작: ${devCommand}` })

  // 셸로 실행(예: "npm run dev"). detached 로 프로세스 그룹을 만들어 트리 전체를 종료 가능하게.
  const child: ChildProcess = spawn(devCommand, {
    cwd: projectPath,
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (d: string) =>
    onProgress({ phase: 'devserver', message: 'dev 서버 구동 중…', log: d.trimEnd() })
  )
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (d: string) =>
    onProgress({ phase: 'devserver', message: 'dev 서버 구동 중…', log: d.trimEnd() })
  )

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
      throw new Error(`dev 서버가 조기 종료됨 (code ${child.exitCode}). devCommand 를 확인하세요.`)
    }
    if (await isUp(readyUrl)) {
      onProgress({ phase: 'devserver', message: '서버 준비 완료 ✓', done: true })
      return { stop }
    }
    await delay(700)
  }

  stop()
  throw new Error(`서버 준비 대기 시간 초과 (${readyUrl}, ${readyTimeoutMs}ms). readyUrl/타임아웃을 확인하세요.`)
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
