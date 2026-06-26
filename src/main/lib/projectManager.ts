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
import { authSetupPrompt, checklistPrompt, testsPrompt, rulesHeader } from './prompts'
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
    await fs.writeFile(gi, ['reports/', 'test-results/', '.auth/', ''].join('\n'), 'utf8')
  }
}

function playwrightConfigTemplate(): string {
  return `import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'

// auto-qa 가 생성/관리. 설정은 .qa/config.json 에서 읽는다.
const cfg = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
const authEnabled = !!(cfg.auth && cfg.auth.enabled)
const STORAGE = '.qa/.auth/state.json'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // fail-fast: 실패 N개 발생 시 즉시 중단 (0/미설정이면 끝까지)
  maxFailures: cfg.maxFailures && cfg.maxFailures > 0 ? cfg.maxFailures : undefined,
  reporter: [['json', { outputFile: './reports/last.json' }], ['list']],
  use: {
    baseURL: cfg.baseURL,
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

/** [AI] 요구사항 → 체크리스트 생성 */
export async function generateChecklist(
  projectPath: string,
  requirementName: string,
  onProgress: (e: ProgressEvent) => void
): Promise<Checklist> {
  const id = slug(requirementName)
  const outPath = join(checklistDir(projectPath), `${id}.md`)
  const requirementPath = join(reqDir(projectPath), requirementName)
  const rules = rulesHeader(await composeRules(projectPath, 'checklist'))

  const res = await runClaude({
    projectPath,
    prompt: rules + checklistPrompt({ requirementName, requirementPath, checklistId: id, outPath }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'checklist',
    onProgress
  })
  if (!res.ok) throw new Error(res.error || '체크리스트 생성 실패')
  if (!existsSync(outPath)) throw new Error('체크리스트 파일이 생성되지 않았습니다.')
  return readChecklist(projectPath, id)
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
