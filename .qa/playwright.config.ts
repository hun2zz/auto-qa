import { defineConfig } from '@playwright/test'

// auto-qa 가 생성/관리. 값은 실행 시 환경변수로 주입됨.
const authEnabled = process.env.QA_AUTH_ENABLED === '1'
const maxFailures = Number(process.env.QA_MAX_FAILURES || '0')
const STORAGE = '.qa/.auth/state.json'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // fail-fast: 실패 N개 발생 시 즉시 중단 (0/미설정이면 끝까지)
  maxFailures: maxFailures > 0 ? maxFailures : undefined,
  reporter: [['list']],
  use: {
    baseURL: process.env.QA_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    // 로그인 셋업: 한 번 로그인 → 세션을 STORAGE 에 저장. 실패하면 main 은 자동 skip.
    ...(authEnabled ? [{ name: 'setup', testMatch: /auth\.setup\.ts/ }] : []),
    {
      name: 'main',
      testIgnore: authEnabled ? /auth\.setup\.ts/ : undefined,
      dependencies: authEnabled ? ['setup'] : [],
      use: authEnabled ? { storageState: STORAGE } : {}
    }
  ]
})
