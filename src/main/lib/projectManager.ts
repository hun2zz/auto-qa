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
import {
  auditPrompt,
  authSetupPrompt,
  checklistPrompt,
  codeTestsPrompt,
  decomposePrompt,
  indexHeader,
  seedAnalysisPrompt,
  seedScriptPrompt,
  strengthenPrompt,
  seedHeader,
  testCoveragePrompt,
  testsPrompt,
  rulesHeader
} from './prompts'
import { buildIndex, getIndex, validateSelectors } from './codeIndex'
import type {
  AssertionReport,
  AssertionStrength,
  AssertionTest,
  CoverageItem,
  CoverageKind,
  CoverageReport,
  CoverageStatus,
  EvalResult,
  EvalScore,
  TestFile,
  TestScope
} from '@shared/types'
import { AUTH_ENV, STORAGE_STATE_REL } from './auth'
import { composeRules, ensureRules } from './rules'

// ----------------------------------------------------------------------------
// .qa 폴더 레이아웃
// ----------------------------------------------------------------------------
const QA = '.qa'
const qaDir = (p: string): string => join(p, QA)
const reqDir = (p: string): string => join(p, QA, 'requirements')
// /qa-capture 스킬이 개발 중 캡처한 '의도 원장'. 요구사항과 동일하게 취급한다.
const intentDir = (p: string): string => join(p, QA, 'intent')
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
  await fs.mkdir(intentDir(path), { recursive: true })
  await fs.mkdir(checklistDir(path), { recursive: true })
  await fs.mkdir(testsDir(path), { recursive: true })
  await fs.mkdir(reportDir(path), { recursive: true })

  if (!existsSync(configPath(path))) {
    await fs.writeFile(configPath(path), JSON.stringify(DEFAULT_QA_CONFIG, null, 2), 'utf8')
  }
  await ensureRules(path)
  // grounding 인덱스 (셀렉터 환각 방지) — 연결 시 1회 빌드
  await buildIndex(path).catch(() => {})
  // playwright.config 은 툴이 생성/관리하므로 항상 최신 템플릿으로 갱신
  await fs.writeFile(join(qaDir(path), 'playwright.config.ts'), playwrightConfigTemplate(), 'utf8')
  const gi = join(qaDir(path), '.gitignore')
  if (!existsSync(gi)) {
    await fs.writeFile(
      gi,
      ['reports/', 'test-results/', '.auth/', '.work/', '.bak/', '.mutation-bak/', ''].join('\n'),
      'utf8'
    )
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
// 시드 데이터 (known-world). 파괴적 실행은 runner 의 opt-in setupCommand 만.
// ----------------------------------------------------------------------------

const knownWorldPath = (p: string): string => join(qaDir(p), 'seed', 'known-world.md')

export async function getKnownWorld(projectPath: string): Promise<string> {
  return fs.readFile(knownWorldPath(projectPath), 'utf8').catch(() => '')
}

/** grounding 인덱스 헤더 (없으면 빈 문자열) */
async function indexHdr(projectPath: string): Promise<string> {
  const idx = await getIndex(projectPath)
  return idx ? indexHeader(idx) : ''
}

export async function saveKnownWorld(projectPath: string, content: string): Promise<void> {
  await fs.mkdir(join(qaDir(projectPath), 'seed'), { recursive: true })
  await fs.writeFile(knownWorldPath(projectPath), content, 'utf8')
}

/** [AI] 시드 스크립트 분석 → known-world 문서 작성 + setup 명령 제안 (DB 실행 없음) */
export async function analyzeSeed(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<{ knownWorld: string; suggestedCommand: string }> {
  const outPath = knownWorldPath(projectPath)
  await fs.mkdir(join(qaDir(projectPath), 'seed'), { recursive: true })
  onProgress({ phase: 'analyze', message: '시드/스키마 분석 중…' })
  const res = await runClaude({
    projectPath,
    prompt: seedAnalysisPrompt({ outPath }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'analyze',
    onProgress
  })
  if (!res.ok) throw new Error(res.error || '시드 분석 실패')
  const knownWorld = await getKnownWorld(projectPath)
  const m = (res.summary || '').match(/SETUP:\s*(.+)/i)
  return { knownWorld, suggestedCommand: m ? m[1].trim() : '' }
}

/** [AI] DB 스키마를 읽어 테스트 시드 스크립트(.qa/seed/seed.mjs)를 생성. 반환=실행 명령. */
export async function generateSeed(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<{ scriptRel: string; command: string }> {
  const seedDir = join(qaDir(projectPath), 'seed')
  await fs.mkdir(seedDir, { recursive: true })
  const outFile = join(seedDir, 'seed.mjs')
  onProgress({ phase: 'analyze', message: 'DB 스키마 분석 → 시드 스크립트 생성 중…' })
  const res = await runClaude({
    projectPath,
    prompt: seedScriptPrompt({ seedDir, outFile }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'analyze',
    onProgress
  })
  if (!res.ok) throw new Error(res.error || '시드 스크립트 생성 실패')
  // AI 가 .mjs/.ts/.js 중 하나로 썼을 수 있어 탐색
  const made = ['seed.mjs', 'seed.ts', 'seed.js']
    .map((f) => join(seedDir, f))
    .find((p) => existsSync(p))
  if (!made) throw new Error('시드 스크립트가 생성되지 않았습니다.')
  const scriptRel = join('.qa', 'seed', made.split('/').pop()!)
  return { scriptRel, command: `node ${scriptRel}` }
}

// ----------------------------------------------------------------------------
// 초기화 (생성물 삭제)
// ----------------------------------------------------------------------------

export type ResetScope = 'generated' | 'all'

/** 생성물 삭제. generated=체크리스트/테스트/리포트/커버리지, all=요구사항·의도까지. 설정/규칙/로그인은 유지 */
export async function resetProject(projectPath: string, scope: ResetScope): Promise<void> {
  const dirs = [
    checklistDir(projectPath),
    testsDir(projectPath),
    reportDir(projectPath),
    join(qaDir(projectPath), 'coverage'),
    join(qaDir(projectPath), '.work')
  ]
  if (scope === 'all') {
    dirs.push(reqDir(projectPath), intentDir(projectPath))
  }
  for (const d of dirs) {
    await fs.rm(d, { recursive: true, force: true })
    await fs.mkdir(d, { recursive: true })
  }
}

// ----------------------------------------------------------------------------
// 요구사항
// ----------------------------------------------------------------------------

export async function listRequirements(projectPath: string): Promise<RequirementFile[]> {
  const out: RequirementFile[] = []
  // 업로드 요구사항 + /qa-capture 의도 원장(.qa/intent) 둘 다 요구사항으로 노출
  for (const dir of [reqDir(projectPath), intentDir(projectPath)]) {
    if (!existsSync(dir)) continue
    const isIntent = dir === intentDir(projectPath)
    for (const name of (await fs.readdir(dir)).sort()) {
      if (name.startsWith('.')) continue
      const path = join(dir, name)
      const stat = await fs.stat(path).catch(() => null)
      if (!stat?.isFile()) continue
      const text = isTextLike(name) ? await fs.readFile(path, 'utf8').catch(() => '') : ''
      out.push({
        name,
        path,
        preview: (isIntent ? '[의도 원장] ' : '') + (text.slice(0, 280) || '(미리보기 없음)')
      })
    }
  }
  return out
}

/** 요구사항 파일명 → 실제 경로 (requirements/intent 양쪽에서 탐색) */
function resolveRequirementPath(projectPath: string, name: string): string {
  const r = join(reqDir(projectPath), name)
  if (existsSync(r)) return r
  const i = join(intentDir(projectPath), name)
  if (existsSync(i)) return i
  return r
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
    const checklistFile = join(dir, f)
    const raw = await fs.readFile(checklistFile, 'utf8')
    const c = parseChecklist(slug(f), raw)

    // 변경 감지: 원본 요구사항이 체크리스트보다 최신? 체크리스트가 spec보다 최신?
    const cMtime = await mtime(checklistFile)
    const reqMtime = await mtime(resolveRequirementPath(projectPath, c.sourceRequirement))
    const specMtime = c.specPath ? await mtime(join(qaDir(projectPath), c.specPath)) : null
    c.sourceStale = reqMtime != null && cMtime != null && reqMtime > cMtime
    c.specStale = c.specPath != null && specMtime != null && cMtime != null && cMtime > specMtime

    out.push(c)
  }
  return out
}

async function mtime(path: string): Promise<number | null> {
  try {
    return (await fs.stat(path)).mtimeMs
  } catch {
    return null
  }
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
  const requirementPath = resolveRequirementPath(projectPath, requirementName)
  const rules =
    rulesHeader(await composeRules(projectPath, 'checklist')) +
    seedHeader(await getKnownWorld(projectPath)) +
    (await indexHdr(projectPath))

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
  const rules =
    rulesHeader(await composeRules(projectPath, 'tests')) +
    seedHeader(await getKnownWorld(projectPath)) +
    (await indexHdr(projectPath))

  const res = await runClaude({
    projectPath,
    // 체크리스트 내용을 프롬프트에 직접 주입 → AI 가 체크리스트를 다시 Read 하지 않아 탐색 턴이 준다.
    prompt:
      rules +
      testsPrompt({
        checklistId,
        checklistPath,
        checklistTitle: checklist.title,
        checklistContent: checklist.markdown,
        specOutPath,
        baseURL
      }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'tests',
    onProgress
  })
  if (!res.ok) throw new Error(res.error || '테스트 생성 실패')
  if (!existsSync(specOutPath)) throw new Error('테스트 spec 파일이 생성되지 않았습니다.')

  const updated: Checklist = { ...checklist, specPath: specRel }
  // specPath 기록은 '내용 변경'이 아니라 부기(bookkeeping)다. 이 저장으로 체크리스트
  // mtime 이 spec 보다 나중이 되면, 방금 만든 테스트가 즉시 'specStale(재생성 필요)' 로
  // 잡힌다. 따라서 저장 후 체크리스트 mtime 을 원래대로 복원해 의미 없는 stale 을 막는다.
  const before = await fs.stat(checklistPath).catch(() => null)
  await fs.writeFile(checklistPath, serializeChecklist(updated), 'utf8')
  if (before) await fs.utimes(checklistPath, before.atime, before.mtime).catch(() => {})
  return updated
}

/** [AI] 코드 기준 characterization(회귀+커버리지) 테스트 생성 → .qa/tests/code-*.spec.ts */
export async function generateCodeTests(
  projectPath: string,
  onProgress: (e: ProgressEvent) => void
): Promise<number> {
  const rules =
    rulesHeader(await composeRules(projectPath, 'tests')) +
    seedHeader(await getKnownWorld(projectPath)) +
    (await indexHdr(projectPath))
  onProgress({ phase: 'tests', message: '코드 분석 → 회귀·커버리지 테스트 생성 중…' })
  const res = await runClaude({
    projectPath,
    prompt: rules + codeTestsPrompt({ testsDir: testsDir(projectPath) }),
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'tests',
    onProgress
  })
  if (!res.ok) throw new Error(res.error || '코드 기준 테스트 생성 실패')
  const made = (await fs.readdir(testsDir(projectPath))).filter(
    (f) => f.startsWith('code-') && f.endsWith('.spec.ts')
  )
  if (made.length === 0) throw new Error('코드 기준 테스트가 생성되지 않았습니다.')
  return made.length
}

/** 모든 draft 체크리스트를 일괄 승인 */
export async function approveAllChecklists(projectPath: string): Promise<Checklist[]> {
  const all = await listChecklists(projectPath)
  for (const c of all) {
    if (c.status !== 'approved') {
      await fs.writeFile(
        join(checklistDir(projectPath), `${c.id}.md`),
        serializeChecklist({ ...c, status: 'approved' }),
        'utf8'
      )
    }
  }
  return listChecklists(projectPath)
}

/** [AI] 승인됐지만 spec 없는 체크리스트들 → 테스트 일괄 생성 (병렬) */
export async function generateAllTests(
  projectPath: string,
  baseURL: string,
  onProgress: (e: ProgressEvent) => void
): Promise<Checklist[]> {
  const all = await listChecklists(projectPath)
  const targets = all.filter((c) => c.status === 'approved' && !c.specPath)
  if (targets.length === 0) {
    onProgress({ phase: 'tests', message: '생성할 대상이 없습니다 (승인됐고 spec 없는 체크리스트 없음).' })
    return all
  }
  const CONCURRENCY = 6
  onProgress({ phase: 'tests', message: `${targets.length}개 테스트 생성 (동시 ${CONCURRENCY}개)` })
  let done = 0
  await mapLimit(targets, CONCURRENCY, async (c) => {
    try {
      await generateTests(projectPath, c.id, baseURL, onProgress)
    } catch (e) {
      onProgress({ phase: 'tests', message: `실패: ${c.title} — ${(e as Error).message}` })
    } finally {
      done++
      onProgress({
        phase: 'tests',
        message: `완료 ${done}/${targets.length}`,
        fraction: done / targets.length
      })
    }
  })
  return listChecklists(projectPath)
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
// 단언 강도 분석 (정적, 실행 없음 — 가짜 단언 방어)
// ----------------------------------------------------------------------------

// '진짜 값/상태'를 검증하는 강한 matcher
const STRONG_MATCHERS =
  /\.(toHaveText|toContainText|toHaveURL|toHaveValue|toHaveCount|toHaveAttribute|toHaveTitle|toHaveClass|toHaveJSProperty|toBeChecked|toBeDisabled|toBeEnabled|toBeHidden|toBeFocused|toHaveScreenshot)\b/
// 존재 여부만 보는 약한 matcher
const WEAK_MATCHERS = /\.(toBeVisible|toBeAttached|toBeInViewport|toBeDefined|toBeTruthy)\b/

/** 생성된 테스트의 단언 강도를 정적 분석 (파일 읽기 + 휴리스틱, 사이드이펙트 0) */
/** 파일명이 대상 트랙(scope=요구사항, code=코드기준)에 속하나 */
function inScope(file: string, scope: TestScope): boolean {
  if (scope === 'all') return true
  const isCode = file.startsWith('code-')
  return scope === 'code' ? isCode : !isCode
}

export async function analyzeAssertions(
  projectPath: string,
  scope: TestScope = 'all'
): Promise<AssertionReport> {
  const dir = testsDir(projectPath)
  const tests: AssertionTest[] = []
  if (existsSync(dir)) {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.spec.ts') && inScope(f, scope))
    for (const f of files.sort()) {
      const src = await fs.readFile(join(dir, f), 'utf8').catch(() => '')
      for (const t of splitTests(src)) {
        tests.push(scoreTest(f, t.title, t.fixme, t.body))
      }
    }
  }
  const strong = tests.filter((t) => t.strength === 'strong').length
  const weak = tests.filter((t) => t.strength === 'weak').length
  const vacuous = tests.filter((t) => t.strength === 'vacuous').length
  const skipped = tests.filter((t) => t.strength === 'skipped').length
  const active = tests.length - skipped
  // 약한·공허 먼저 정렬 (고칠 것 위로)
  const order: Record<AssertionStrength, number> = { vacuous: 0, weak: 1, strong: 2, skipped: 3 }
  tests.sort((a, b) => order[a.strength] - order[b.strength])
  return {
    total: tests.length,
    strong,
    weak,
    vacuous,
    skipped,
    strengthPct: active ? Math.round((strong / active) * 1000) / 10 : 0,
    tests
  }
}

interface RawTest {
  title: string
  fixme: boolean
  body: string
}

/** spec 소스를 개별 test 블록으로 쪼갬 (describe 무시, 중괄호 깊이 추적) */
function splitTests(src: string): RawTest[] {
  const out: RawTest[] = []
  const re = /\btest(\.(fixme|skip|only))?\s*\(\s*(['"`])([\s\S]*?)\3/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const fixme = m[2] === 'fixme' || m[2] === 'skip'
    const title = m[4]
    // 본문: 이 test 의 callback 시작부터 다음 test 까지 (대략) — 다음 test( 위치까지
    const start = re.lastIndex
    re.lastIndex = start // 다음 검색 위치 보존
    const nextIdx = src.slice(start).search(/\btest(\.(fixme|skip|only))?\s*\(/)
    const body = nextIdx === -1 ? src.slice(start) : src.slice(start, start + nextIdx)
    out.push({ title, fixme, body })
  }
  return out
}

function scoreTest(spec: string, title: string, fixme: boolean, body: string): AssertionTest {
  if (fixme) {
    return { spec, title, strength: 'skipped', assertions: 0, reason: 'test.fixme/skip (비활성)' }
  }
  const expects = (body.match(/\bexpect\s*\(/g) || []).length
  const hasStrong = STRONG_MATCHERS.test(body)
  const hasWeak = WEAK_MATCHERS.test(body)
  // 리터럴을 단언하는 공허한 expect (expect(true).toBeTruthy() 등)
  const trivialCount = (body.match(/\bexpect\s*\(\s*(true|false|\d+)\s*\)/g) || []).length

  if (expects === 0) {
    return { spec, title, strength: 'vacuous', assertions: 0, reason: 'expect 단언이 없음' }
  }
  if (trivialCount >= expects) {
    return {
      spec,
      title,
      strength: 'vacuous',
      assertions: expects,
      reason: '모든 단언이 리터럴(expect(true) 등) — 아무것도 검증 안 함'
    }
  }
  if (hasStrong) {
    return { spec, title, strength: 'strong', assertions: expects }
  }
  if (hasWeak) {
    return {
      spec,
      title,
      strength: 'weak',
      assertions: expects,
      reason: '존재 여부만 확인(toBeVisible 등) — 값/상태 단언 없음'
    }
  }
  return { spec, title, strength: 'weak', assertions: expects, reason: '강한 단언 미검출' }
}

/** .qa/tests 의 생성된 spec 파일 목록 (체크리스트 유무와 무관하게 실제 파일 기준) */
export async function listTestFiles(projectPath: string): Promise<TestFile[]> {
  const dir = testsDir(projectPath)
  if (!existsSync(dir)) return []
  const out: TestFile[] = []
  for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith('.spec.ts')).sort()) {
    const src = await fs.readFile(join(dir, f), 'utf8').catch(() => '')
    const tests = splitTests(src)
    out.push({
      name: f,
      kind: f.startsWith('code-') ? 'code' : 'checklist',
      tests: tests.length,
      fixmes: tests.filter((t) => t.fixme).length
    })
  }
  return out
}

/**
 * [AI 루프] 약한/공허 단언을 '강한 값 단언'으로 재작성 → 재채점을 목표/한도까지 반복.
 * 근거(인덱스+known-world)를 주입해 가짜 강함을 막고, 진전 없으면 수렴으로 중단.
 */
export async function runStrengthenLoop(
  projectPath: string,
  targetPct: number,
  maxIterations: number,
  onProgress: (e: ProgressEvent) => void,
  scope: TestScope = 'all'
): Promise<AssertionReport> {
  let report = await analyzeAssertions(projectPath, scope)
  if (report.total === 0) {
    onProgress({ phase: 'tests', message: '생성된 테스트가 없습니다.', done: true })
    return report
  }
  for (let i = 0; i < maxIterations; i++) {
    if (report.strengthPct >= targetPct) {
      onProgress({ phase: 'tests', message: `목표 강도 ${targetPct}% 달성 (현재 ${report.strengthPct}%)`, done: true })
      break
    }
    const targets = report.tests.filter((t) => t.strength === 'vacuous' || t.strength === 'weak')
    if (targets.length === 0) {
      onProgress({ phase: 'tests', message: '강화할 약한/공허 테스트가 없습니다.', done: true })
      break
    }
    onProgress({
      phase: 'tests',
      message: `반복 ${i + 1}/${maxIterations} — 강도 ${report.strengthPct}% · 강화 대상 ${targets.length}`,
      fraction: Math.min(1, report.strengthPct / targetPct)
    })
    const targetList = targets
      .slice(0, 40)
      .map((t) => `- ${t.spec} · "${t.title}" — ${t.reason ?? t.strength}`)
      .join('\n')
    const rules =
      rulesHeader(await composeRules(projectPath, 'tests')) +
      seedHeader(await getKnownWorld(projectPath)) +
      (await indexHdr(projectPath))
    const res = await runClaude({
      projectPath,
      prompt: rules + strengthenPrompt({ targets: targetList, testsDir: testsDir(projectPath) }),
      allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
      phase: 'tests',
      onProgress
    })
    if (!res.ok) throw new Error(res.error || '단언 강화 실패')
    const next = await analyzeAssertions(projectPath, scope)
    // 진전 없으면(강한 단언 수가 늘지 않음) 수렴으로 중단 — 무한 no-op 방지
    if (next.strong <= report.strong) {
      report = next
      onProgress({ phase: 'tests', message: `더 강화할 게 없습니다 (수렴, ${report.strengthPct}%)`, done: true })
      break
    }
    report = next
  }
  return report
}

// ----------------------------------------------------------------------------
// 생성기 채점 (이력 추적) — 프롬프트/규칙 변경 전후 비교
// ----------------------------------------------------------------------------

const evalHistoryPath = (p: string): string => join(qaDir(p), 'evals', 'history.json')

/** 현재 생성된 테스트의 품질을 채점하고 이력에 기록 (정적, 실행 없음) */
export async function runEval(projectPath: string, scope: TestScope = 'all'): Promise<EvalResult> {
  const a = await analyzeAssertions(projectPath, scope)
  const v = await validateSelectors(projectPath, scope)
  const current: EvalScore = {
    at: new Date().toISOString(),
    total: a.total,
    strong: a.strong,
    weak: a.weak,
    vacuous: a.vacuous,
    strengthPct: a.strengthPct,
    inventedSelectors: v.invented.length
  }
  let history: EvalScore[] = []
  try {
    history = JSON.parse(await fs.readFile(evalHistoryPath(projectPath), 'utf8'))
  } catch {
    history = []
  }
  const prev = history.length ? history[history.length - 1] : null
  history.push(current)
  await fs.mkdir(join(qaDir(projectPath), 'evals'), { recursive: true })
  await fs.writeFile(evalHistoryPath(projectPath), JSON.stringify(history.slice(-50), null, 2), 'utf8')
  return { current, prev, history: history.slice(-12) }
}

// ----------------------------------------------------------------------------
// QA 1: 구현 완료 커버리지 감사 (브라우저 불필요, 코드 근거 감사)
// ----------------------------------------------------------------------------

const coveragePath = (p: string, kind: CoverageKind, id: string): string =>
  join(reportDir(p), `coverage-${kind}-${id}.json`)

export async function auditCoverage(
  projectPath: string,
  requirementName: string,
  kind: CoverageKind,
  onProgress: (e: ProgressEvent) => void
): Promise<CoverageReport> {
  const id = slug(requirementName)
  const requirementPath = resolveRequirementPath(projectPath, requirementName)
  const workOut = join(qaDir(projectPath), '.work', `coverage-${kind}-${id}.json`)
  await fs.mkdir(join(qaDir(projectPath), '.work'), { recursive: true })
  await fs.rm(workOut).catch(() => {})

  const label = kind === 'test' ? '테스트 커버리지 감사' : '구현 감사'
  onProgress({ phase: 'analyze', message: `${label} 중: ${requirementName}` })
  const prompt =
    kind === 'test'
      ? testCoveragePrompt({ requirementPath, testsDir: testsDir(projectPath), outPath: workOut })
      : auditPrompt({ requirementPath, outPath: workOut })
  const res = await runClaude({
    projectPath,
    prompt,
    allowedTools: ['Read', 'Grep', 'Glob', 'Write'],
    phase: 'analyze',
    onProgress
  })
  if (!res.ok) throw new Error(`${label} 실패: ${res.error || ''}`)
  if (!existsSync(workOut)) throw new Error('감사 결과 파일이 생성되지 않았습니다.')

  const parsed = JSON.parse(await fs.readFile(workOut, 'utf8'))
  const rawItems: unknown[] = Array.isArray(parsed) ? parsed : (parsed?.items ?? [])
  const items: CoverageItem[] = rawItems.map((r) => {
    const o = r as Record<string, unknown>
    const status = normalizeCoverage(String(o?.status ?? ''))
    return {
      requirement: String(o?.requirement ?? '(미상)'),
      status,
      evidence: String(o?.evidence ?? ''),
      note: o?.note ? String(o.note) : undefined
    }
  })
  const implemented = items.filter((i) => i.status === 'implemented').length
  const partial = items.filter((i) => i.status === 'partial').length
  const missing = items.filter((i) => i.status === 'missing').length
  const total = items.length
  const report: CoverageReport = {
    kind,
    requirementName,
    generatedAt: new Date().toISOString(),
    total,
    implemented,
    partial,
    missing,
    completionRate: total ? (implemented + 0.5 * partial) / total : 0,
    items
  }
  await fs.writeFile(coveragePath(projectPath, kind, id), JSON.stringify(report, null, 2), 'utf8')
  onProgress({
    phase: 'analyze',
    message: `${label} 완료 — ${Math.round(report.completionRate * 100)}% (gap ${missing + partial})`,
    done: true
  })
  return report
}

function normalizeCoverage(s: string): CoverageStatus {
  const v = s.toLowerCase()
  if (v.startsWith('impl')) return 'implemented'
  if (v.startsWith('part')) return 'partial'
  return 'missing'
}

export async function getCoverageReports(projectPath: string): Promise<CoverageReport[]> {
  const dir = reportDir(projectPath)
  if (!existsSync(dir)) return []
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith('coverage-') && f.endsWith('.json'))
  const out: CoverageReport[] = []
  for (const f of files.sort()) {
    try {
      out.push(JSON.parse(await fs.readFile(join(dir, f), 'utf8')))
    } catch {
      /* skip */
    }
  }
  return out
}

// ----------------------------------------------------------------------------
// 리포트
// ----------------------------------------------------------------------------

export { lastReportPath, qaDir, reportDir, testsDir }
