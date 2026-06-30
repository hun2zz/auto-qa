import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CiScaffoldResult } from '@shared/types'

/**
 * CI 게이트 스캐폴드: 타겟 repo 에 '헤드리스 러너'(.qa/ci/run.mjs)와 GitHub Action 을 만든다.
 * 테스트 '실행'은 AI 가 필요 없으므로 CI 에서 그대로 돈다. 파일은 사용자가 검토 후 커밋.
 * (덮어쓰지 않음 — 이미 있으면 건너뜀)
 */
export async function scaffoldCI(projectPath: string): Promise<CiScaffoldResult> {
  const written: string[] = []
  const skipped: string[] = []

  const targets: { rel: string; content: string }[] = [
    { rel: join('.qa', 'ci', 'run.mjs'), content: RUNNER },
    { rel: join('.github', 'workflows', 'qa.yml'), content: WORKFLOW }
  ]

  for (const t of targets) {
    const abs = join(projectPath, t.rel)
    if (existsSync(abs)) {
      skipped.push(t.rel)
      continue
    }
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, t.content, 'utf8')
    written.push(t.rel)
  }
  return { written, skipped }
}

// 헤드리스 러너 — Electron/AI 없이 .qa/tests 를 실행. CI·로컬 공용. (node .qa/ci/run.mjs)
const RUNNER = `#!/usr/bin/env node
// auto-qa 헤드리스 러너 — AI/Electron 없이 .qa/tests 를 실행한다. CI 게이트 + 로컬 공용.
// 사용: node .qa/ci/run.mjs   (실패 시 종료코드 1 → PR 게이트)
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('.qa/config.json', 'utf8'))
const env = {
  ...process.env,
  QA_BASE_URL: cfg.baseURL,
  QA_AUTH_ENABLED: cfg.auth && cfg.auth.enabled ? '1' : '0',
  QA_MAX_FAILURES: String(cfg.maxFailures || 0)
}

function sh(cmd, args, opts = {}) {
  return new Promise((res) => {
    const c = spawn(cmd, args, { stdio: 'inherit', shell: opts.shell, env, ...opts })
    c.on('close', (code) => res(code))
    c.on('error', () => res(1))
  })
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitUp(url, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 60000)
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url)
      if (r.status < 500) return true
    } catch {}
    await delay(800)
  }
  return false
}

const dev = spawn(cfg.devCommand, { shell: true, env, detached: true, stdio: 'inherit' })
const stop = () => {
  try { process.kill(-dev.pid, 'SIGTERM') } catch {}
}
process.on('exit', stop)

let code = 1
try {
  // (선택) 시드
  if (cfg.seed && cfg.seed.enabled && cfg.seed.setupCommand) {
    await sh(cfg.seed.setupCommand, [], { shell: true })
  }
  const ok = await waitUp(cfg.readyUrl, cfg.readyTimeoutMs)
  if (!ok) {
    console.error('dev 서버 준비 실패: ' + cfg.readyUrl)
    process.exit(1)
  }
  code = await sh('npx', ['--yes', 'playwright', 'test', '--config', '.qa/playwright.config.ts', '--reporter=line'])
} finally {
  stop()
}
process.exit(code === 0 ? 0 : 1)
`

const WORKFLOW = `name: QA
on:
  pull_request:
  workflow_dispatch:

jobs:
  qa:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      # 타겟에 @playwright/test 가 없으면 설치
      - run: npm i -D @playwright/test
      - run: npx playwright install --with-deps chromium
      # 시드가 필요하면 여기 DB 환경변수 / 서비스 컨테이너를 추가하세요.
      - name: Run QA (.qa/tests)
        run: node .qa/ci/run.mjs
`
