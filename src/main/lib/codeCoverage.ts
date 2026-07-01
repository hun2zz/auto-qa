import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { delimiter, join, resolve as resolvePath } from 'node:path'
import type { CodeCoverageReport, CoverageMetric, ProgressEvent } from '@shared/types'
import { createServer } from 'node:net'
import { runClaude } from './claudeRunner'
import { flowTestsPrompt } from './prompts'
import { loadProjectEnv } from './dotenv'

/** OS 가 비어있는 포트를 할당받아 반환 (커버리지 서버 포트 충돌 방지) */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/** baseURL 의 포트만 교체 */
function replacePort(baseURL: string, port: number): string {
  try {
    const u = new URL(baseURL)
    u.port = String(port)
    return u.origin
  } catch {
    return `http://localhost:${port}`
  }
}

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

interface CovContext {
  env: NodeJS.ProcessEnv
  server: { stop: () => void }
  restorers: Array<() => Promise<void>>
  warning?: string
}

/** 패치 + production 빌드 + 서버 기동 (1회). 이후 테스트만 여러 번 재실행 가능. */
async function prepareCoverage(
  projectPath: string,
  baseURL: string,
  onProgress: (e: ProgressEvent) => void
): Promise<CovContext> {
  const restorers: Array<() => Promise<void>> = []
  await ensureDeps(projectPath, onProgress)
  await writeHarness(projectPath)

  // spec import 교체는 measureOnce 에서 매 측정 직전에 수행(루프가 새로 만든 spec 도 포함되게).
  // 여기서는 복원만 등록 — 정상/비정상 종료 모두 원본(@playwright/test)으로 되돌린다.
  restorers.push(async () => {
    await restoreSpecImports(projectPath)
  })

  const sm = await patchSourceMaps(projectPath)
  if (sm.restore) restorers.push(sm.restore)
  const ts = await patchTsconfig(projectPath)
  if (ts) restorers.push(ts)

  // 직전 실패 빌드가 남긴 오염된 .next 캐시를 재사용하면 /_global-error 등으로 계속
  // 실패할 수 있어, 커버리지 빌드 전에 .next 를 비워 항상 깨끗한 빌드를 보장한다.
  await fs.rm(join(projectPath, '.next'), { recursive: true, force: true }).catch(() => {})
  // 프로젝트 .env 를 빌드에 주입 (prisma generate 등은 DATABASE_URL 을 요구함)
  const projectEnv = loadProjectEnv(projectPath)
  onProgress({ phase: 'analyze', message: 'production 빌드 중… (.next 초기화 후, 수 분 소요)' })
  const build = await run(
    projectPath,
    'npm',
    ['run', 'build'],
    // NODE_ENV=production 강제: Electron(electron-vite dev)은 NODE_ENV=development 로
    // 돌아 그게 빌드에 상속되면 next build 가 dev/prod 혼재 상태로 빌드돼
    // /_not-found·/_global-error prerender 가 'useContext null' 로 깨진다.
    { NODE_OPTIONS: '--max-old-space-size=4096', ...projectEnv, NODE_ENV: 'production' },
    onProgress
  )
  if (build.code !== 0) {
    for (const r of restorers.reverse()) await r().catch(() => {})
    const tail = build.tail
    let hint: string
    if (/Missing required environment variable|PrismaConfigEnvError/i.test(tail)) {
      hint = '빌드에 필요한 환경변수가 없습니다 (예: DATABASE_URL). 프로젝트 루트에 .env 를 만들어 필요한 값을 채워주세요.'
    } else if (/Unable to acquire lock|another instance of next build|\.next[/\\]lock/i.test(tail)) {
      hint = '다른 빌드 또는 dev 서버가 실행 중입니다 (.next/lock 경합). 그 프로세스를 종료하고 다시 시도하세요.'
    } else {
      hint = '다른 dev 서버가 떠있거나 메모리 부족일 수 있습니다.'
    }
    throw new Error(`production 빌드 실패 (code ${build.code}). ${hint}\n${tail.slice(-800)}`)
  }

  // 포트 충돌 방지: 빈 포트를 할당받아 커버리지 서버를 그 포트로 띄운다.
  const freePort = await findFreePort()
  const effectiveURL = replacePort(baseURL, freePort)
  onProgress({ phase: 'devserver', message: `커버리지 서버 기동 중… (${effectiveURL})` })
  const covOut = join(projectPath, '.v8-coverage')
  await fs.rm(covOut, { recursive: true, force: true })
  await fs.mkdir(covOut, { recursive: true })
  restorers.push(async () => {
    await fs.rm(covOut, { recursive: true, force: true })
  })
  const server = await startServer(projectPath, effectiveURL, covOut, onProgress)

  const tool = toolPaths(projectPath)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    QA_BASE_URL: effectiveURL, // 빈 포트로 띄운 커버리지 서버 주소로 테스트
    NODE_PATH: tool.nodeModules + (process.env.NODE_PATH ? delimiter + process.env.NODE_PATH : ''),
    FORCE_COLOR: '0'
  }
  return { env, server, restorers, warning: sm.warning }
}

/** 현재 .qa/tests 의 테스트를 실행해 커버리지 측정(재빌드 없음) */
async function measureOnce(
  projectPath: string,
  ctx: CovContext,
  onProgress: (e: ProgressEvent) => void
): Promise<CodeCoverageReport> {
  const specs = await listSpecs(projectPath)
  // 매 측정 직전 fixture import 적용 — 루프가 이번 반복에 새로 생성한 spec 도 클라 커버리지가 잡히게.
  await applyFixtureImports(projectPath)
  onProgress({ phase: 'playwright', message: `테스트 ${specs.length}개 실행 + 커버리지 수집 중…` })
  const tool = toolPaths(projectPath)
  const pw = await run(
    projectPath,
    tool.cmd,
    [...tool.prefix, 'test', '--config', join('.qa', 'coverage', 'playwright.config.ts')],
    ctx.env,
    onProgress
  )
  let warning = ctx.warning
  if (pw.code !== 0)
    warning = (warning ? warning + ' / ' : '') + '일부 테스트 실패(커버리지는 계속 수집됨)'
  const report = await parseReport(projectPath, specs, warning)
  await fs.mkdir(join(qaDir(projectPath), 'reports'), { recursive: true }).catch(() => {})
  await fs
    .writeFile(codeCoveragePath(projectPath), JSON.stringify(report, null, 2), 'utf8')
    .catch(() => {})
  return report
}

async function cleanup(ctx: CovContext): Promise<void> {
  ctx.server?.stop()
  // 서버가 종료하며 .v8-coverage 에 마지막 커버리지를 flush 하므로, 잠시 기다린 뒤
  // 정리(restorers)를 돌려 .v8-coverage 가 다시 생기는(leftover) 것을 막는다.
  await delay(800)
  for (const r of ctx.restorers.reverse()) await r().catch(() => {})
}

export async function runCodeCoverage(
  projectPath: string,
  baseURL: string,
  onProgress: (e: ProgressEvent) => void
): Promise<CodeCoverageReport> {
  if ((await listSpecs(projectPath)).length === 0)
    return fail('생성된 테스트(.qa/tests/*.spec.ts)가 없습니다. 먼저 테스트를 생성하세요.')
  let ctx: CovContext
  try {
    ctx = await prepareCoverage(projectPath, baseURL, onProgress)
  } catch (e) {
    return fail((e as Error).message)
  }
  try {
    const report = await measureOnce(projectPath, ctx, onProgress)
    onProgress({
      phase: 'playwright',
      message: `코드 커버리지 — 라인 ${report.lines.pct}% (실행 파일 ${report.executedFiles}/${report.totalFiles})`,
      done: true
    })
    return report
  } catch (e) {
    return fail((e as Error).message)
  } finally {
    await cleanup(ctx)
  }
}

/**
 * [흐름 기반 커버리지 루프] 빌드 1회 → (측정 → gap을 flow로 묶어 flow 테스트 생성)를 목표/한도까지 반복.
 * 조각(함수)이 아니라 '흐름' 단위로 테스트를 늘려 가짜 커버리지를 피한다.
 */
export async function runCoverageLoop(
  projectPath: string,
  baseURL: string,
  targetPct: number,
  maxIterations: number,
  onProgress: (e: ProgressEvent) => void
): Promise<CodeCoverageReport> {
  if ((await listSpecs(projectPath)).length === 0)
    return fail('생성된 테스트가 없습니다. 먼저 테스트를 생성하세요.')
  let ctx: CovContext
  try {
    ctx = await prepareCoverage(projectPath, baseURL, onProgress)
  } catch (e) {
    return fail((e as Error).message)
  }
  let report: CodeCoverageReport | null = null
  // 헛돌이 방지: 직전 라운드에 타깃(gap)이었는데 재측정에도 안 오른 파일 → '못 채우는 것'으로 보고 제외.
  // (static page/layout 처럼 구조상 안 잡히는 파일을 무한히 쫓지 않게 함)
  const stuck = new Set<string>()
  let prevPct: Record<string, number> = {}
  try {
    for (let i = 0; i < maxIterations; i++) {
      report = await measureOnce(projectPath, ctx, onProgress)
      if (report.fatalError) break
      // 직전 타깃 중 개선 없는 파일을 stuck 으로 승격
      for (const g of report.gaps) {
        if (g.pct < 50 && prevPct[g.file] != null && g.pct <= prevPct[g.file]) stuck.add(g.file)
      }
      prevPct = Object.fromEntries(report.gaps.map((g) => [g.file, g.pct]))
      onProgress({
        phase: 'analyze',
        message: `반복 ${i + 1}/${maxIterations} — 라인 ${report.lines.pct}% (목표 ${targetPct}%)`,
        fraction: Math.min(1, report.lines.pct / targetPct)
      })
      if (report.lines.pct >= targetPct) {
        onProgress({ phase: 'analyze', message: `목표 ${targetPct}% 달성`, done: true })
        break
      }
      if (i === maxIterations - 1) break // 마지막 반복은 측정으로 끝
      // gap → flow 테스트 생성 (다음 측정에 반영). 못 잡는 static·stuck 파일은 제외.
      const made = await generateFlowTests(projectPath, report.gaps, stuck, onProgress)
      if (made === 0) {
        onProgress({ phase: 'analyze', message: '더 채울 수 있는 gap 이 없습니다(수렴).', done: true })
        break
      }
    }
    return report ?? fail('측정 결과가 없습니다.')
  } finally {
    await cleanup(ctx)
  }
}

/**
 * E2E 커버리지로 '구조상' 못 잡는 Next 빌드타임 특수 파일(메타데이터/에셋 라우트).
 * icon/apple-icon/opengraph-image/twitter-image/sitemap/robots/manifest — 요청 때 실행되지 않고
 * 빌드 때 에셋으로 구워지므로 루프가 아무 테스트를 만들어도 커버리지가 안 오른다 → gap 에서 제외.
 */
const UNCOVERABLE_SPECIAL =
  /(^|\/)(icon|apple-icon|opengraph-image|twitter-image|sitemap|robots|manifest)\.[jt]sx?$/
function isUncoverableGap(file: string): boolean {
  return UNCOVERABLE_SPECIAL.test(file)
}

/** [AI] gap(안 덮인 파일)을 흐름으로 묶어 그 흐름의 E2E 테스트 생성 → .qa/tests/code-flow-*.spec.ts */
async function generateFlowTests(
  projectPath: string,
  gaps: { file: string; pct: number }[],
  exclude: Set<string>,
  onProgress: (e: ProgressEvent) => void
): Promise<number> {
  // 채울 수 있는 gap 만 남긴다: 50% 미만 & 구조상 못 잡는 static 특수파일 아님 & stuck 아님.
  const targets = gaps.filter((g) => g.pct < 50 && !isUncoverableGap(g.file) && !exclude.has(g.file))
  const skipped = gaps.filter((g) => g.pct < 50).length - targets.length
  if (targets.length === 0) {
    // 못 잡는 gap 뿐이면 AI 를 호출하지 않는다(토큰 낭비·헛돌이 방지).
    if (skipped > 0)
      onProgress({ phase: 'tests', message: `남은 gap ${skipped}개는 구조상 못 잡음 → 생성 생략` })
    return 0
  }
  // AI 가 파일명을 code-flow-* 가 아닌 code-<flow>* 로 쓸 수 있으므로, '전체 spec 수'의
  // 증가로 생성 여부를 판단한다. (prefix 로만 세면 false 수렴이 발생)
  const before = (await listSpecs(projectPath)).length
  const gapList = targets
    .slice(0, 30)
    .map((g) => `- ${g.file} (${g.pct}%)`)
    .join('\n')
  onProgress({
    phase: 'tests',
    message: `gap을 흐름으로 묶어 flow 테스트 생성 중…${skipped > 0 ? ` (못 잡는 ${skipped}개 제외)` : ''}`
  })
  const res = await runClaude({
    projectPath,
    prompt: flowTestsPrompt({ gaps: gapList, testsDir: join(qaDir(projectPath), 'tests') }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'tests',
    onProgress
  })
  if (!res.ok) return 0
  const after = (await listSpecs(projectPath)).length
  return Math.max(0, after - before)
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

/** 생성된 테스트 spec 파일명 목록 (.qa/tests/*.spec.ts) */
async function listSpecs(projectPath: string): Promise<string[]> {
  const dir = join(qaDir(projectPath), 'tests')
  if (!existsSync(dir)) return []
  return (await fs.readdir(dir)).filter((f) => f.endsWith('.spec.ts')).sort()
}

async function writeHarness(projectPath: string): Promise<void> {
  const dir = covDir(projectPath)
  await fs.mkdir(dir, { recursive: true })

  // 실제 생성된 테스트(.qa/tests/*.spec.ts)를 nextcov 하니스로 실행한다.
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
  testDir: '../tests', testMatch: /\\.spec\\.ts$/,
  globalSetup: './global-setup.mjs', globalTeardown: './global-teardown.mjs',
  reporter: [['list']], timeout: 60000, fullyParallel: true,
  use: { baseURL: process.env.QA_BASE_URL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // @ts-expect-error nextcov 확장
  nextcov
})
`,
    'utf8'
  )
  // nextcov 는 ESM 전용이라, harness 를 .mjs(ESM)로 써야 CommonJS 프로젝트에서도
  // import.meta 에러 없이 로드된다. (__dirname 대신 import.meta.dirname 사용)
  await fs.writeFile(
    join(dir, 'global-setup.mjs'),
    `import { join } from 'node:path'
import { initCoverage, loadNextcovConfig } from 'nextcov/playwright'
export default async function () {
  const c = await loadNextcovConfig(join(import.meta.dirname, 'playwright.config.ts'))
  await initCoverage(c)
}
`,
    'utf8'
  )
  await fs.writeFile(
    join(dir, 'global-teardown.mjs'),
    `import { join } from 'node:path'
import { finalizeCoverage, loadNextcovConfig } from 'nextcov/playwright'
export default async function () {
  const c = await loadNextcovConfig(join(import.meta.dirname, 'playwright.config.ts'))
  await finalizeCoverage(c)
}
`,
    'utf8'
  )
  // 클라이언트(브라우저) 커버리지 수집 fixture.
  // ⚠️ collectClientCoverage 는 config.outputDir 가 없으면 저장을 통째로 스킵한다
  //   (내부: cacheDir = outputDir ? join(outputDir,'.cache') : undefined).
  //   그래서 반드시 playwright.config 의 nextcov.outputDir 와 '같은 값'을 넘겨야
  //   finalize 가 그 .cache 를 읽어 클라 커버리지를 병합한다. (안 넘기면 컴포넌트 전부 0%)
  // export * 로 devices/타입 등 원본 export 를 그대로 통과시키고 test 만 확장본으로 덮는다.
  await fs.writeFile(
    join(dir, 'fixtures.ts'),
    `import { test as base } from '@playwright/test'
import { collectClientCoverage } from 'nextcov/playwright'
export * from '@playwright/test'
export const test = base.extend<{ coverage: void }>({
  coverage: [
    async ({ page }, use, testInfo) => {
      await collectClientCoverage(page, testInfo, use, { outputDir: '${COVERAGE_OUTPUT_DIR}' })
    },
    { scope: 'test', auto: true }
  ]
})
`,
    'utf8'
  )
}

/** nextcov 리포트 출력 폴더 (config 의 outputDir 와 fixture 의 outputDir 가 반드시 일치해야 함) */
const COVERAGE_OUTPUT_DIR = '.qa/coverage/report'

/**
 * .qa/tests/*.spec.ts 의 `from '@playwright/test'` 를 `from '../coverage/fixtures'` 로 바꿔
 * 클라 커버리지 fixture(auto)가 모든 테스트에 붙게 한다. 반환된 restore 로 원복한다.
 * 정규식 양방향(patch/restore)이라 이전 실행이 중간에 죽어 남은 패치도 스스로 원복된다.
 */
const FIXTURE_IMPORT = /from ['"]\.\.\/coverage\/fixtures['"]/g
const PW_IMPORT = /from ['"]@playwright\/test['"]/g

/** .qa/tests/*.spec.ts 전부에 정규식 치환(바뀐 파일만 기록). from 은 매번 새 lastIndex. */
async function subSpecs(projectPath: string, from: RegExp, to: string): Promise<number> {
  const dir = join(qaDir(projectPath), 'tests')
  if (!existsSync(dir)) return 0
  const specs = (await fs.readdir(dir)).filter((f) => f.endsWith('.spec.ts'))
  let n = 0
  await Promise.all(
    specs.map(async (f) => {
      const p = join(dir, f)
      const s = await fs.readFile(p, 'utf8')
      const out = s.replace(new RegExp(from.source, 'g'), to) // 파일마다 새 정규식(lastIndex 오염 방지)
      if (out !== s) {
        await fs.writeFile(p, out, 'utf8')
        n++
      }
    })
  )
  return n
}

/** spec 들의 @playwright/test import 를 커버리지 fixture 로 교체(바뀐 파일 수 반환).
 *  idempotent — 루프가 매 반복 새로 만든 spec 도 매 측정 직전에 다시 패치되게 measureOnce 에서 호출한다. */
async function applyFixtureImports(projectPath: string): Promise<number> {
  return subSpecs(projectPath, PW_IMPORT, "from '../coverage/fixtures'")
}

/**
 * .qa/tests/*.spec.ts 의 fixture import 를 원래 `@playwright/test` 로 되돌린다.
 * 커버리지가 비정상 종료돼 패치가 남았을 때 일반 실행이 깨지지 않도록 하는 방어 복원.
 * 되돌린 파일 수를 반환(0 이면 남은 패치 없음).
 */
export async function restoreSpecImports(projectPath: string): Promise<number> {
  return subSpecs(projectPath, FIXTURE_IMPORT, "from '@playwright/test'")
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
  // productionBrowserSourceMaps(클라 소스맵)만 켠다.
  // experimental.serverSourceMaps 는 Next 16 에서 /_global-error prerender 를 깨뜨려서 제외.
  const inject = '\n  productionBrowserSourceMaps: true,'
  const patched = original.replace(anchor[1], anchor[1] + inject)
  await fs.writeFile(file, patched, 'utf8')
  return {
    warning: '서버 소스맵 미사용(클라 커버리지 위주). 서버측 remap 은 제한적일 수 있음.',
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
  const port = (() => {
    try {
      return new URL(baseURL).port || '3000'
    } catch {
      return '3000'
    }
  })()
  // next 는 -p 로, npm 폴백은 PORT env 로 포트 지정 (할당받은 빈 포트 사용)
  const child = spawn(useNext ? nextBin : 'npm', useNext ? ['start', '-p', port] : ['start'], {
    cwd: projectPath,
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ...loadProjectEnv(projectPath),
      NODE_ENV: 'production', // production 빌드 산출물을 서비스하므로
      PORT: port,
      NODE_V8_COVERAGE: covOut,
      NODE_OPTIONS: '--inspect=9230'
    },
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
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/'
  const perFile: { file: string; pct: number }[] = []
  for (const f of files) {
    const s = c[f].s ?? {}
    let any = false
    let ft = 0,
      fc = 0
    for (const k in s) {
      sT++
      ft++
      if (s[k] > 0) {
        sC++
        fc++
        any = true
      }
    }
    perFile.push({
      file: f.startsWith(prefix) ? f.slice(prefix.length) : f,
      pct: ft ? Math.round((fc / ft) * 1000) / 10 : 0
    })
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
  const gaps = perFile.sort((a, b) => a.pct - b.pct || a.file.localeCompare(b.file)).slice(0, 60)
  return {
    generatedAt: new Date().toISOString(),
    gaps,
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
function toolPaths(projectPath: string): ToolPaths {
  const appRoot = resolvePath(import.meta.dirname, '..', '..')
  // nextcov 가 여기 있으므로 nodeModules(=NODE_PATH 대상)는 항상 auto-qa 번들로 둔다.
  const nodeModules = join(appRoot, 'node_modules')
  const pwBin = process.platform === 'win32' ? 'playwright.cmd' : 'playwright'

  // 러너 바이너리는 config/spec 의 @playwright/test 와 같은 설치본이어야 한다.
  // 커버리지는 타겟이 자체 @playwright/test 를 갖는 것이 전제이므로(precondition 체크),
  // 타겟 바이너리를 우선 사용한다(서로 다른 설치본 → "No tests found" 방지).
  const targetBin = join(projectPath, 'node_modules', '.bin', pwBin)
  if (existsSync(targetBin)) return { cmd: targetBin, prefix: [], nodeModules }

  const bundledBin = join(nodeModules, '.bin', pwBin)
  if (existsSync(bundledBin)) return { cmd: bundledBin, prefix: [], nodeModules }
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
    gaps: [],
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
