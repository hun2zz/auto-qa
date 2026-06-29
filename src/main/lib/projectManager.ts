import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  DEFAULT_QA_CONFIG,
  type Checklist,
  type ChecklistStatus,
  type ProgressEvent,
  type ProjectInfo,
  type QaConfig,
  type RequirementFile
} from '@shared/types'
import { runClaude } from './claudeRunner'
import { authSetupPrompt, checklistPrompt, decomposePrompt, testsPrompt, rulesHeader } from './prompts'
import { AUTH_ENV, STORAGE_STATE_REL } from './auth'
import { composeRules, ensureRules } from './rules'

// ----------------------------------------------------------------------------
// .qa 폴더 레이아웃
// ----------------------------------------------------------------------------
const QA = '.qa'
const qaDir = (p: string): string => join(p, QA)
const reqDir = (p: string): string => join(p, QA, 'requirements')
const checklistDir = (p: string): string => join(p, QA, 'checklists')
const testsDir = (p: string): string => join(p, QA, 'tests')
const configPath = (p: string): string => join(p, QA, 'config.json')
const reportDir = (p: string): string => join(p, QA, 'reports')
const lastReportPath = (p: string): string => join(p, QA, 'reports', 'last.json')

const slug = (name: string): string =>
  basename(name)
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'item'

// ----------------------------------------------------------------------------
// 프로젝트 연결 / 스캐폴딩
// ----------------------------------------------------------------------------

export async function connectProject(projectPath: string): Promise<ProjectInfo> {
  const path = resolve(projectPath)
  const hadQa = existsSync(qaDir(path))
  await ensureScaffold(path)
  return { path, name: basename(path), hasQaFolder: hadQa }
}

async function ensureScaffold(path: string): Promise<void> {
  await fs.mkdir(reqDir(path), { recursive: true })
  await fs.mkdir(checklistDir(path), { recursive: true })
  await fs.mkdir(testsDir(path), { recursive: true })
  await fs.mkdir(reportDir(path), { recursive: true })

  if (!existsSync(configPath(path))) {
    await fs.writeFile(configPath(path), JSON.stringify(DEFAULT_QA_CONFIG, null, 2), 'utf8')
  }
  await ensureRules(path)
  // playwright.config 은 툴이 생성/관리하므로 항상 최신 템플릿으로 갱신
  await fs.writeFile(join(qaDir(path), 'playwright.config.ts'), playwrightConfigTemplate(), 'utf8')
  const gi = join(qaDir(path), '.gitignore')
  if (!existsSync(gi)) {
    await fs.writeFile(gi, ['reports/', 'test-results/', '.auth/', '.work/', ''].join('\n'), 'utf8')
  }
}

function playwrightConfigTemplate(): string {
  // 설정값은 실행 시 환경변수로 주입한다(QA_*). 파일/ import.meta 를 쓰지 않아
  // 타겟 프로젝트가 CommonJS 든 ESM 이든 동일하게 동작한다.
  return `import { defineConfig } from '@playwright/test'

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
    ...(authEnabled ? [{ name: 'setup', testMatch: /auth\\.setup\\.ts/ }] : []),
    {
      name: 'main',
      testIgnore: authEnabled ? /auth\\.setup\\.ts/ : undefined,
      dependencies: authEnabled ? ['setup'] : [],
      use: authEnabled ? { storageState: STORAGE } : {}
    }
  ]
})
`
}

/** playwright.config 을 최신 템플릿으로 다시 쓴다 (실행 전 항상 보장) */
export async function writePlaywrightConfig(projectPath: string): Promise<void> {
  await fs.writeFile(
    join(qaDir(projectPath), 'playwright.config.ts'),
    playwrightConfigTemplate(),
    'utf8'
  )
}

// ----------------------------------------------------------------------------
// config
// ----------------------------------------------------------------------------

export async function getConfig(projectPath: string): Promise<QaConfig> {
  try {
    const raw = await fs.readFile(configPath(projectPath), 'utf8')
    return { ...DEFAULT_QA_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_QA_CONFIG
  }
}

export async function saveConfig(projectPath: string, config: QaConfig): Promise<void> {
  await fs.writeFile(configPath(projectPath), JSON.stringify(config, null, 2), 'utf8')
}

// ----------------------------------------------------------------------------
// 요구사항
// ----------------------------------------------------------------------------

export async function listRequirements(projectPath: string): Promise<RequirementFile[]> {
  const dir = reqDir(projectPath)
  if (!existsSync(dir)) return []
  const files = await fs.readdir(dir)
  const out: RequirementFile[] = []
  for (const name of files.sort()) {
    if (name.startsWith('.')) continue
    const path = join(dir, name)
    const text = await fs.readFile(path, 'utf8').catch(() => '')
    out.push({ name, path, preview: text.slice(0, 280) })
  }
  return out
}

/** 외부 파일을 .qa/requirements/ 로 복사 (md/txt/pdf/이미지 등 — AI 단계에서 Claude 가 직접 읽음) */
export async function importRequirement(
  projectPath: string,
  sourcePath: string
): Promise<RequirementFile> {
  const name = basename(sourcePath)
  const dest = join(reqDir(projectPath), name)
  await fs.copyFile(sourcePath, dest)
  // 텍스트 계열만 미리보기 시도(바이너리는 빈 미리보기)
  const text = isTextLike(name) ? await fs.readFile(dest, 'utf8').catch(() => '') : ''
  return { name, path: dest, preview: text.slice(0, 280) || '(미리보기 없음 · AI 가 직접 읽습니다)' }
}

/** 붙여넣은 텍스트를 .md 로 저장 */
export async function addRequirementText(
  projectPath: string,
  title: string,
  content: string
): Promise<RequirementFile> {
  const base = slug(title) || 'requirement'
  let name = `${base}.md`
  let i = 2
  while (existsSync(join(reqDir(projectPath), name))) name = `${base}-${i++}.md`
  const dest = join(reqDir(projectPath), name)
  const body = `# ${title.trim() || '요구사항'}\n\n${content.trim()}\n`
  await fs.writeFile(dest, body, 'utf8')
  return { name, path: dest, preview: body.slice(0, 280) }
}

function isTextLike(name: string): boolean {
  return /\.(md|markdown|txt|csv|json|ya?ml|html?)$/i.test(name)
}

// ----------------------------------------------------------------------------
// 체크리스트 (frontmatter + markdown)
// ----------------------------------------------------------------------------

function parseChecklist(id: string, raw: string): Checklist {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta: Record<string, string> = {}
  let body = raw
  if (fm) {
    body = fm[2]
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/)
      if (m) meta[m[1]] = m[2].trim()
    }
  }
  const spec = meta.spec && meta.spec !== 'null' ? meta.spec : null
  return {
    id: meta.id || id,
    title: meta.title || id,
    sourceRequirement: meta.source || '',
    markdown: body.trim(),
    status: (meta.status as ChecklistStatus) === 'approved' ? 'approved' : 'draft',
    specPath: spec
  }
}

function serializeChecklist(c: Checklist): string {
  return `---
id: ${c.id}
title: ${c.title}
source: ${c.sourceRequirement}
status: ${c.status}
spec: ${c.specPath ?? 'null'}
---

${c.markdown.trim()}
`
}

export async function listChecklists(projectPath: string): Promise<Checklist[]> {
  const dir = checklistDir(projectPath)
  if (!existsSync(dir)) return []
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'))
  const out: Checklist[] = []
  for (const f of files.sort()) {
    const raw = await fs.readFile(join(dir, f), 'utf8')
    out.push(parseChecklist(slug(f), raw))
  }
  return out
}

async function readChecklist(projectPath: string, id: string): Promise<Checklist> {
  const raw = await fs.readFile(join(checklistDir(projectPath), `${id}.md`), 'utf8')
  return parseChecklist(id, raw)
}

interface Module {
  id: string
  title: string
  summary: string
}

/**
 * [AI] 요구사항 → 체크리스트 생성.
 * 거대 요구사항은 먼저 '모듈'로 분해한 뒤 모듈마다 체크리스트를 만든다(빠짐없이 커버).
 * 분해가 1개 이하면 단일 체크리스트로 폴백한다.
 */
export async function generateChecklist(
  projectPath: string,
  requirementName: string,
  onProgress: (e: ProgressEvent) => void
): Promise<Checklist[]> {
  const baseId = slug(requirementName)
  const requirementPath = join(reqDir(projectPath), requirementName)
  const rules = rulesHeader(await composeRules(projectPath, 'checklist'))

  // 1) 분해
  onProgress({ phase: 'checklist', message: '요구사항을 테스트 모듈로 분해 중…' })
  const modules = await decompose(projectPath, requirementPath, onProgress)

  // 폴백: 분해 실패/단일 → 기존처럼 체크리스트 1개
  if (modules.length <= 1) {
    const id = modules[0] ? `${baseId}__${slug(modules[0].id)}` : baseId
    const c = await genOneChecklist(projectPath, {
      checklistId: id,
      requirementName,
      requirementPath,
      rules,
      module: modules[0],
      onProgress
    })
    return [c]
  }

  // 2) 모듈마다 체크리스트 — 동시 실행으로 가속 (각 AI 호출이 독립적)
  const CONCURRENCY = 4
  onProgress({
    phase: 'checklist',
    message: `${modules.length}개 모듈 → 체크리스트 생성 (동시 ${CONCURRENCY}개)`
  })
  let done = 0
  const results = await mapLimit(modules, CONCURRENCY, async (m) => {
    try {
      const c = await genOneChecklist(projectPath, {
        checklistId: `${baseId}__${slug(m.id)}`,
        requirementName,
        requirementPath,
        rules,
        module: m,
        onProgress
      })
      done++
      onProgress({
        phase: 'checklist',
        message: `완료 ${done}/${modules.length}: ${m.title}`,
        fraction: done / modules.length
      })
      return c
    } catch (e) {
      done++
      onProgress({
        phase: 'checklist',
        message: `모듈 실패 ${done}/${modules.length}: ${m.title} — ${(e as Error).message}`,
        fraction: done / modules.length
      })
      return null
    }
  })
  const out = results.filter((c): c is Checklist => c !== null)
  if (out.length === 0) throw new Error('체크리스트가 하나도 생성되지 않았습니다.')
  return out
}

/** 동시 실행 상한을 둔 map (순서 보존) */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

/** 요구사항을 모듈 리스트로 분해 (실패 시 빈 배열) */
async function decompose(
  projectPath: string,
  requirementPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<Module[]> {
  const workDir = join(qaDir(projectPath), '.work')
  await fs.mkdir(workDir, { recursive: true })
  const outPath = join(workDir, 'modules.json')
  await fs.rm(outPath).catch(() => {})

  const res = await runClaude({
    projectPath,
    prompt: decomposePrompt({ requirementPath, outPath }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'checklist',
    onProgress
  })
  if (!res.ok || !existsSync(outPath)) return []
  try {
    const raw = JSON.parse(await fs.readFile(outPath, 'utf8'))
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const mods: Module[] = []
    for (const m of raw) {
      const id = slug(String(m?.id || m?.title || ''))
      if (!id || seen.has(id)) continue
      seen.add(id)
      mods.push({ id, title: String(m?.title || id), summary: String(m?.summary || '') })
      if (mods.length >= 30) break
    }
    return mods
  } catch {
    return []
  }
}

async function genOneChecklist(
  projectPath: string,
  args: {
    checklistId: string
    requirementName: string
    requirementPath: string
    rules: string
    module?: Module
    onProgress: (e: ProgressEvent) => void
  }
): Promise<Checklist> {
  const outPath = join(checklistDir(projectPath), `${args.checklistId}.md`)
  const res = await runClaude({
    projectPath,
    prompt:
      args.rules +
      checklistPrompt({
        requirementName: args.requirementName,
        requirementPath: args.requirementPath,
        checklistId: args.checklistId,
        outPath,
        module: args.module ? { title: args.module.title, summary: args.module.summary } : undefined
      }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'checklist',
    onProgress: args.onProgress
  })
  if (!res.ok) throw new Error(res.error || '체크리스트 생성 실패')
  if (!existsSync(outPath)) throw new Error('체크리스트 파일이 생성되지 않았습니다.')
  return readChecklist(projectPath, args.checklistId)
}

export async function saveChecklist(
  projectPath: string,
  id: string,
  markdown: string
): Promise<void> {
  const current = await readChecklist(projectPath, id)
  await fs.writeFile(
    join(checklistDir(projectPath), `${id}.md`),
    serializeChecklist({ ...current, markdown }),
    'utf8'
  )
}

export async function approveChecklist(projectPath: string, id: string): Promise<Checklist> {
  const current = await readChecklist(projectPath, id)
  const approved: Checklist = { ...current, status: 'approved' }
  await fs.writeFile(join(checklistDir(projectPath), `${id}.md`), serializeChecklist(approved), 'utf8')
  return approved
}

/** [AI] 승인된 체크리스트 → Playwright 테스트 생성 */
export async function generateTests(
  projectPath: string,
  checklistId: string,
  baseURL: string,
  onProgress: (e: ProgressEvent) => void
): Promise<Checklist> {
  const checklist = await readChecklist(projectPath, checklistId)
  if (checklist.status !== 'approved') {
    throw new Error('승인된 체크리스트만 테스트로 변환할 수 있습니다.')
  }
  const specRel = `tests/${checklistId}.spec.ts`
  const specOutPath = join(qaDir(projectPath), specRel)
  const checklistPath = join(checklistDir(projectPath), `${checklistId}.md`)
  const rules = rulesHeader(await composeRules(projectPath, 'tests'))

  const res = await runClaude({
    projectPath,
    prompt: rules + testsPrompt({ checklistId, checklistPath, specOutPath, baseURL }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'tests',
    onProgress
  })
  if (!res.ok) throw new Error(res.error || '테스트 생성 실패')
  if (!existsSync(specOutPath)) throw new Error('테스트 spec 파일이 생성되지 않았습니다.')

  const updated: Checklist = { ...checklist, specPath: specRel }
  await fs.writeFile(
    join(checklistDir(projectPath), `${checklistId}.md`),
    serializeChecklist(updated),
    'utf8'
  )
  return updated
}

// ----------------------------------------------------------------------------
// 로그인 셋업 생성 (AI)
// ----------------------------------------------------------------------------

/** [AI] 로그인 페이지를 읽어 auth.setup.ts(세션 저장 셋업) 생성 */
export async function generateAuthSetup(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<void> {
  const config = await getConfig(projectPath)
  if (!config.auth?.enabled) throw new Error('설정에서 로그인(auth)을 먼저 켜고 로그인 URL/아이디를 입력하세요.')

  const setupOutPath = join(qaDir(projectPath), 'tests', 'auth.setup.ts')
  const rules = rulesHeader(await composeRules(projectPath, 'auth'))
  const res = await runClaude({
    projectPath,
    prompt:
      rules +
      authSetupPrompt({
      loginUrl: config.auth.loginUrl,
      setupOutPath,
      storageStateRel: STORAGE_STATE_REL,
      userEnv: AUTH_ENV.user,
      passEnv: AUTH_ENV.password,
      urlEnv: AUTH_ENV.loginUrl
    }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'tests',
    onProgress
  })
  if (!res.ok) throw new Error(res.error || '로그인 셋업 생성 실패')
  if (!existsSync(setupOutPath)) throw new Error('auth.setup.ts 가 생성되지 않았습니다.')
}

// ----------------------------------------------------------------------------
// 리포트
// ----------------------------------------------------------------------------

export { lastReportPath, qaDir, reportDir, testsDir }
