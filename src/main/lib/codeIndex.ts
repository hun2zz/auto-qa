import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CodeIndex, SelectorValidation } from '@shared/types'

/**
 * grounding 인덱스: 프로젝트의 '진짜' 셀렉터/라우트를 정적 추출.
 * AI 가 없는 셀렉터를 지어내지 못하게 생성 프롬프트에 주입하고, 생성된 테스트를 검증한다.
 * (정적 grep — 실행·변경 없음)
 */

const qaDir = (p: string): string => join(p, '.qa')
const indexPath = (p: string): string => join(qaDir(p), 'index', 'index.json')

const SRC_DIRS = ['src', 'app', 'components', 'pages']
const CODE_RE = /\.(tsx|ts|jsx|js|mdx)$/
const SKIP_DIRS = new Set(['node_modules', '.next', '.qa', '.git', 'dist', 'out', 'coverage'])

export async function getIndex(projectPath: string): Promise<CodeIndex | null> {
  try {
    return JSON.parse(await fs.readFile(indexPath(projectPath), 'utf8'))
  } catch {
    return null
  }
}

/** 인덱스를 정적 추출해 저장 + 반환 */
export async function buildIndex(projectPath: string): Promise<CodeIndex> {
  const testids = new Set<string>()
  const ariaLabels = new Set<string>()

  const roots = SRC_DIRS.map((d) => join(projectPath, d)).filter((d) => existsSync(d))
  // src 류 폴더가 하나도 없으면 프로젝트 루트를 얕게 스캔
  if (roots.length === 0) roots.push(projectPath)

  for (const root of roots) {
    await walk(root, (text) => {
      for (const m of text.matchAll(/data-testid\s*=\s*["'`]([^"'`]+)["'`]/g)) testids.add(m[1])
      for (const m of text.matchAll(/aria-label\s*=\s*["'`]([^"'`{]+)["'`]/g))
        ariaLabels.add(m[1].trim())
    })
  }

  const routes = await discoverRoutes(projectPath)

  const index: CodeIndex = {
    testids: [...testids].sort(),
    ariaLabels: [...ariaLabels].sort().slice(0, 200),
    routes,
    builtAt: new Date().toISOString()
  }
  await fs.mkdir(join(qaDir(projectPath), 'index'), { recursive: true })
  await fs.writeFile(indexPath(projectPath), JSON.stringify(index, null, 2), 'utf8')
  return index
}

/** 생성된 테스트의 getByTestId 가 인덱스에 없으면 = 지어낸 셀렉터로 의심 */
export async function validateSelectors(projectPath: string): Promise<SelectorValidation> {
  const index = (await getIndex(projectPath)) ?? (await buildIndex(projectPath))
  const real = new Set(index.testids)
  const dir = join(qaDir(projectPath), 'tests')
  const invented: SelectorValidation['invented'] = []
  let specs = 0
  if (existsSync(dir)) {
    for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith('.spec.ts'))) {
      specs++
      const src = await fs.readFile(join(dir, f), 'utf8').catch(() => '')
      for (const m of src.matchAll(/getByTestId\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
        if (!real.has(m[1])) invented.push({ spec: f, selector: `getByTestId('${m[1]}')` })
      }
    }
  }
  return { specsScanned: specs, testidsInProject: index.testids.length, invented }
}

// ── 내부 ──────────────────────────────────────────────────

async function walk(dir: string, onFile: (text: string) => void): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(join(dir, e.name), onFile)
    } else if (e.isFile() && CODE_RE.test(e.name)) {
      const text = await fs.readFile(join(dir, e.name), 'utf8').catch(() => '')
      if (text) onFile(text)
    }
  }
}

async function discoverRoutes(projectPath: string): Promise<string[]> {
  const appDir = ['src/app', 'app'].map((d) => join(projectPath, d)).find((d) => existsSync(d))
  if (!appDir) return []
  const routes = new Set<string>(['/'])
  async function walkRoutes(dir: string, segs: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.isFile() && /^page\.(tsx|ts|jsx|js|mdx)$/.test(e.name)) {
        routes.add('/' + segs.filter(Boolean).join('/') || '/')
      } else if (e.isDirectory()) {
        if (e.name.startsWith('_') || e.name === 'api') continue
        const seg = e.name.startsWith('(') && e.name.endsWith(')') ? '' : e.name
        await walkRoutes(join(dir, e.name), [...segs, seg])
      }
    }
  }
  await walkRoutes(appDir, [])
  return [...routes].sort().slice(0, 120)
}
