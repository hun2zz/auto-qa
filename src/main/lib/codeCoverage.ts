import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { delimiter, join, resolve as resolvePath } from 'node:path'
import type { CodeCoverageReport, CoverageMetric, ProgressEvent } from '@shared/types'

/**
 * 코드 커버리지 (서버+클라). nextcov(V8 기반)로 Turbopack 호환.
 * production 빌드 + NODE_V8_COVERAGE(서버) + Playwright CDP(클라) → 소스맵 remap → %.
 * 무거운 별도 모드: 타겟 next.config/tsconfig 를 '임시 패치'(백업·복원)하고 production 빌드를 돈다.
 */

const qaDir = (p: string): string => join(p, '.qa')
const covDir = (p: string): string => join(qaDir(p), 'coverage')
const codeCoveragePath = (p: string): string => join(qaDir(p), 'reports', 'code-coverage.json')

export async function getCodeCoverage(projectPath: string): Promise<CodeCoverageReport | null> {
  try {
    return JSON.parse(await fs.readFile(codeCoveragePath(projectPath), 'utf8'))
  } catch {
    return null
  }
}

export async function runCodeCoverage(
  projectPath: string,
  baseURL: string,
  onProgress: (e: ProgressEvent) => void
): Promise<CodeCoverageReport> {
  const restorers: Array<() => Promise<void>> = []
  let server: { stop: () => void } | null = null
  let warning: string | undefined

  try {
    // 1) 의존성 보장 (nextcov, @playwright/test)
    await ensureDeps(projectPath, onProgress)

    // 2) 라우트 발견 (src/app 의 page 파일)
    const routes = await discoverRoutes(projectPath)
    onProgress({ phase: 'analyze', message: `커버리지 대상 라우트 ${routes.length}개 발견` })

    // 3) 하니스 작성 (.qa/coverage)
    await writeHarness(projectPath)

    // 4) 임시 패치: 소스맵(next.config) + .qa 빌드 제외(tsconfig)
    const sm = await patchSourceMaps(projectPath)
    if (sm.restore) restorers.push(sm.restore)
    if (sm.warning) warning = sm.warning
    const ts = await patchTsconfig(projectPath)
    if (ts) restorers.push(ts)

    // 5) production 빌드 (소스맵). 메모리 상향으로 build worker OOM 완화.
    onProgress({ phase: 'analyze', message: 'production 빌드 중… (수 분 소요)' })
    const build = await run(
      projectPath,
      'npm',
      ['run', 'build'],
      { NODE_OPTIONS: '--max-old-space-size=4096' },
      onProgress
    )
    if (build.code !== 0) {
      return fail(
        `production 빌드 실패 (code ${build.code}). 다른 dev 서버가 떠있거나 메모리 부족일 수 있습니다. ` +
          `\n${build.tail.slice(-800)}`
      )
    }

    // 6) production 서버 기동 (V8 커버리지). nextcov 기본 스캔 경로 .v8-coverage 사용.
    onProgress({ phase: 'devserver', message: '커버리지 서버 기동 중…' })
    const covOut = join(projectPath, '.v8-coverage')
    await fs.rm(covOut, { recursive: true, force: true })
    await fs.mkdir(covOut, { recursive: true })
    restorers.push(async () => {
      await fs.rm(covOut, { recursive: true, force: true })
    })
    server = await startServer(projectPath, baseURL, covOut, onProgress)

    // 7) Playwright 크롤 (nextcov fixture → 서버+클라 수집)
    onProgress({ phase: 'playwright', message: '라우트 크롤링 + 커버리지 수집 중…' })
    const tool = toolPaths()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      QA_BASE_URL: baseURL,
      QA_COV_ROUTES: JSON.stringify(routes),
      NODE_PATH: tool.nodeModules + (process.env.NODE_PATH ? delimiter + process.env.NODE_PATH : ''),
      FORCE_COLOR: '0'
    }
    const pw = await run(
      projectPath,
      tool.cmd,
      [...tool.prefix, 'test', '--config', join('.qa', 'coverage', 'playwright.config.ts')],
      env,
      onProgress
    )
    if (pw.code !== 0) warning = (warning ? warning + ' / ' : '') + 'Playwright 크롤 일부 실패'

    // 8) 리포트 파싱 + 저장
    const report = await parseReport(projectPath, routes, warning)
    await fs.mkdir(join(qaDir(projectPath), 'reports'), { recursive: true }).catch(() => {})
    await fs
      .writeFile(codeCoveragePath(projectPath), JSON.stringify(report, null, 2), 'utf8')
      .catch(() => {})
    onProgress({
      phase: 'playwright',
      message: `코드 커버리지 — 라인 ${report.lines.pct}% (실행 파일 ${report.executedFiles}/${report.totalFiles})`,
      done: true
    })
    return report
  } catch (e) {
    return fail((e as Error).message)
  } finally {
    server?.stop()
    // 임시 패치 복원 (역순)
    for (const r of restorers.reverse()) await r().catch(() => {})
  }
}

// ----------------------------------------------------------------------------

async function ensureDeps(projectPath: string, onProgress: (e: ProgressEvent) => void): Promise<void> {
  const need: string[] = []
  if (!existsSync(join(projectPath, 'node_modules', 'nextcov'))) need.push('nextcov')
  if (!existsSync(join(projectPath, 'node_modules', '@playwright', 'test')))
    need.push('@playwright/test')
  if (need.length === 0) return
  onProgress({ phase: 'analyze', message: `커버리지 의존성 설치: ${need.join(', ')}` })
  const r = await run(projectPath, 'npm', ['i', '-D', ...need], {}, onProgress)
  if (r.code !== 0) throw new Error(`의존성 설치 실패: ${need.join(', ')}`)
}

/** src/app 의 page 파일에서 정적 라우트 추출 (동적 [..] 제외, 최대 15개) */
async function discoverRoutes(projectPath: string): Promise<string[]> {
  const appDir = ['src/app', 'app'].map((d) => join(projectPath, d)).find((d) => existsSync(d))
  if (!appDir) return ['/']
  const routes = new Set<string>(['/'])
  async function walk(dir: string, segs: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.isFile() && /^page\.(tsx|ts|jsx|js|mdx)$/.test(e.name)) {
        const path = '/' + segs.filter(Boolean).join('/')
        if (!path.includes('[')) routes.add(path === '' ? '/' : path)
      } else if (e.isDirectory()) {
        const name = e.name
        if (name.startsWith('_') || name === 'api') continue
        // (group) 세그먼트는 URL 에 안 들어감
        const seg = name.startsWith('(') && name.endsWith(')') ? '' : name
        if (name.includes('[')) continue // 동적 라우트 스킵
        await walk(join(dir, name), [...segs, seg])
      }
    }
  }
  await walk(appDir, [])
  // 얕은(상위) 라우트 우선 — 보통 public 메인 페이지. admin 류 깊은 경로는 뒤로.
  return [...routes]
    .sort((a, b) => {
      const da = a === '/' ? 0 : a.split('/').length
      const db = b === '/' ? 0 : b.split('/').length
      return da - db || a.localeCompare(b)
    })
    .slice(0, 15)
}

async function writeHarness(projectPath: string): Promise<void> {
  const dir = covDir(projectPath)
  await fs.mkdir(dir, { recursive: true })

  await fs.writeFile(
    join(dir, 'playwright.config.ts'),
    `import { defineConfig, devices } from '@playwright/test'
export const nextcov = {
  cdpPort: 9230, buildDir: '.next', outputDir: '.qa/coverage/report',
  sourceRoot: './src', include: ['src/**/*.{ts,tsx,js,jsx}'],
  exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
  reporters: ['json', 'text-summary'], log: true
}
export default defineConfig({
  testDir: '.', testMatch: /crawl\\.spec\\.ts/,
  globalSetup: './global-setup.ts', globalTeardown: './global-teardown.ts',
  reporter: [['list']], timeout: 60000,
  use: { baseURL: process.env.QA_BASE_URL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // @ts-expect-error nextcov 확장
  nextcov
})
`,
    'utf8'
  )
  await fs.writeFile(
    join(dir, 'global-setup.ts'),
    `import * as path from 'path'
import { initCoverage, loadNextcovConfig } from 'nextcov/playwright'
export default async function () {
  const c = await loadNextcovConfig(path.join(__dirname, 'playwright.config.ts'))
  await initCoverage(c)
}
`,
    'utf8'
  )
  await fs.writeFile(
    join(dir, 'global-teardown.ts'),
    `import * as path from 'path'
import { finalizeCoverage, loadNextcovConfig } from 'nextcov/playwright'
export default async function () {
  const c = await loadNextcovConfig(path.join(__dirname, 'playwright.config.ts'))
  await finalizeCoverage(c)
}
`,
    'utf8'
  )
  await fs.writeFile(
    join(dir, 'fixtures.ts'),
    `import { test as base, expect } from '@playwright/test'
import { collectClientCoverage } from 'nextcov/playwright'
export const test = base.extend({
  coverage: [async ({ page }, use, testInfo) => { await collectClientCoverage(page, testInfo, use) }, { scope: 'test', auto: true }]
})
export { expect }
`,
    'utf8'
  )
  await fs.writeFile(
    join(dir, 'crawl.spec.ts'),
    `import { test, expect } from './fixtures'
const routes: string[] = JSON.parse(process.env.QA_COV_ROUTES || '["/"]')
test('coverage crawl', async ({ page }) => {
  for (const r of routes) {
    await page.goto(r).catch(() => {})
    await page.waitForLoadState('networkidle').catch(() => {})
  }
  expect(true).toBeTruthy()
})
`,
    'utf8'
  )
}

interface PatchResult {
  restore?: () => Promise<void>
  warning?: string
}

/** next.config 에 소스맵 켜기 (백업·복원). 실패하면 warning */
async function patchSourceMaps(projectPath: string): Promise<PatchResult> {
  const ext = ['ts', 'mjs', 'js', 'cjs'].find((e) => existsSync(join(projectPath, `next.config.${e}`)))
  if (!ext) return { warning: 'next.config 를 찾지 못해 소스맵을 못 켰습니다(커버리지 낮을 수 있음).' }
  const file = join(projectPath, `next.config.${ext}`)
  const original = await fs.readFile(file, 'utf8')
  if (/productionBrowserSourceMaps/.test(original)) return {} // 이미 켜짐

  const anchor = original.match(/((?:const|let)\s+\w+\s*(?::\s*\w+)?\s*=\s*\{)/)
  if (!anchor) {
    return { warning: 'next.config 구조를 인식 못 해 소스맵 자동 설정 실패(수동으로 productionBrowserSourceMaps:true 권장).' }
  }
  const hasExperimental = /experimental\s*:/.test(original)
  const inject = hasExperimental
    ? '\n  productionBrowserSourceMaps: true,'
    : '\n  productionBrowserSourceMaps: true,\n  experimental: { serverSourceMaps: true },'
  const patched = original.replace(anchor[1], anchor[1] + inject)
  await fs.writeFile(file, patched, 'utf8')
  return {
    warning: hasExperimental ? '기존 experimental 로 서버 소스맵 일부 누락 가능' : undefined,
    restore: async () => {
      await fs.writeFile(file, original, 'utf8')
    }
  }
}

/** tsconfig 에서 .qa 를 빌드 제외 (백업·복원) */
async function patchTsconfig(projectPath: string): Promise<(() => Promise<void>) | undefined> {
  const file = join(projectPath, 'tsconfig.json')
  if (!existsSync(file)) return undefined
  const original = await fs.readFile(file, 'utf8')
  let json: { exclude?: string[] }
  try {
    json = JSON.parse(original)
  } catch {
    return undefined
  }
  const exclude = new Set(json.exclude ?? ['node_modules'])
  if (exclude.has('.qa')) return undefined
  exclude.add('.qa')
  json.exclude = [...exclude]
  await fs.writeFile(file, JSON.stringify(json, null, 2), 'utf8')
  return async () => {
    await fs.writeFile(file, original, 'utf8')
  }
}

interface ServerHandle {
  stop: () => void
}
async function startServer(
  projectPath: string,
  baseURL: string,
  covOut: string,
  onProgress: (e: ProgressEvent) => void
): Promise<ServerHandle> {
  // next 를 직접 실행해야 V8 커버리지/inspector 가 next 서버 프로세스를 잡는다.
  // (npm start 로 감싸면 npm-cli 프로세스가 잡혀 커버리지가 0 이 됨)
  const nextBin = join(projectPath, 'node_modules', '.bin', 'next')
  const useNext = existsSync(nextBin)
  const child = spawn(useNext ? nextBin : 'npm', useNext ? ['start'] : ['start'], {
    cwd: projectPath,
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    env: { ...process.env, NODE_V8_COVERAGE: covOut, NODE_OPTIONS: '--inspect=9230' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', (d: Buffer) =>
    onProgress({ phase: 'devserver', message: '커버리지 서버…', log: d.toString().trimEnd() })
  )
  const stop = (): void => {
    if (child.pid == null) return
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'])
      else process.kill(-child.pid, 'SIGINT')
    } catch {
      /* ignore */
    }
  }
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`커버리지 서버 조기 종료 (code ${child.exitCode})`)
    if (await isUp(baseURL)) return { stop }
    await delay(700)
  }
  stop()
  throw new Error('커버리지 서버 준비 시간 초과')
}

async function parseReport(
  projectPath: string,
  routes: string[],
  warning?: string
): Promise<CodeCoverageReport> {
  const finalJson = join(covDir(projectPath), 'report', 'coverage-final.json')
  if (!existsSync(finalJson)) return fail('coverage-final.json 이 생성되지 않았습니다.', warning)
  const c = JSON.parse(await fs.readFile(finalJson, 'utf8')) as Record<
    string,
    { s?: Record<string, number>; b?: Record<string, number[]>; f?: Record<string, number> }
  >
  const files = Object.keys(c)
  let sT = 0, sC = 0, fT = 0, fC = 0, bT = 0, bC = 0
  let executed = 0
  for (const f of files) {
    const s = c[f].s ?? {}
    let any = false
    for (const k in s) {
      sT++
      if (s[k] > 0) {
        sC++
        any = true
      }
    }
    const fn = c[f].f ?? {}
    for (const k in fn) {
      fT++
      if (fn[k] > 0) fC++
    }
    const b = c[f].b ?? {}
    for (const k in b) for (const v of b[k]) {
      bT++
      if (v > 0) bC++
    }
    if (any) executed++
  }
  const m = (cov: number, tot: number): CoverageMetric => ({
    covered: cov,
    total: tot,
    pct: tot ? Math.round((cov / tot) * 1000) / 10 : 0
  })
  return {
    generatedAt: new Date().toISOString(),
    statements: m(sC, sT),
    branches: m(bC, bT),
    functions: m(fC, fT),
    lines: m(sC, sT),
    executedFiles: executed,
    totalFiles: files.length,
    routes,
    warning
  }
}

// ── 작은 헬퍼 ──────────────────────────────────────────────
interface ToolPaths {
  cmd: string
  prefix: string[]
  nodeModules: string
}
function toolPaths(): ToolPaths {
  const appRoot = resolvePath(import.meta.dirname, '..', '..')
  const nodeModules = join(appRoot, 'node_modules')
  const bin = join(nodeModules, '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright')
  if (existsSync(bin)) return { cmd: bin, prefix: [], nodeModules }
  return { cmd: 'npx', prefix: ['--yes', 'playwright'], nodeModules }
}

function run(
  projectPath: string,
  cmd: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv,
  onProgress: (e: ProgressEvent) => void
): Promise<{ code: number | null; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: projectPath,
      shell: process.platform === 'win32',
      env: { ...process.env, ...extraEnv }
    })
    let tail = ''
    const onData = (d: Buffer): void => {
      tail = (tail + d.toString()).slice(-4000)
      onProgress({ phase: 'analyze', message: '진행 중…', log: d.toString().trimEnd() })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', () => resolve({ code: 1, tail: tail + '\n(spawn error)' }))
    child.on('close', (code) => resolve({ code, tail }))
  })
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
function fail(msg: string, warning?: string): CodeCoverageReport {
  const z: CoverageMetric = { pct: 0, covered: 0, total: 0 }
  return {
    generatedAt: new Date().toISOString(),
    statements: z,
    branches: z,
    functions: z,
    lines: z,
    executedFiles: 0,
    totalFiles: 0,
    routes: [],
    warning,
    fatalError: msg
  }
}
