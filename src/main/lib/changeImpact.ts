import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import type { AffectedSpec, ChangeImpactReport, RunReport } from '@shared/types'
import { lastReportPath, testsDir } from './projectManager'

/**
 * 변경 영향 분석(TIA).
 * Phase 1 — 마지막 실행 이후 mtime 이 더 최신인 소스 파일 = "고쳤다" 로 감지.
 * Phase 2 — 각 spec 이 '커버한다고 선언/언급한 소스 파일'(src/... 경로)을 파싱해,
 *           변경 파일을 건드리는 spec 을 "재테스트 필수" 로 매핑.
 * git 없이 동작(파일 mtime 기반) → 에디터 저장만으로 감지된다.
 */

/** 변형/생성 대상이 아닌 순수 소스만 걷는다(.ts/.tsx, 테스트/타입/빌드 제외). */
async function walkSource(projectPath: string): Promise<string[]> {
  const out: string[] = []
  const SKIP = new Set(['node_modules', '.next', '.git', '.qa', 'dist', 'out', 'coverage'])
  const walk = async (absDir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') continue
      if (SKIP.has(e.name)) continue
      const abs = join(absDir, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (
        /\.(ts|tsx|js|jsx)$/.test(e.name) &&
        !e.name.endsWith('.d.ts') &&
        !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(e.name)
      )
        out.push(abs)
    }
  }
  // src 우선, 없으면 프로젝트 루트(단 SKIP 폴더 제외)
  const srcDir = join(projectPath, 'src')
  await walk(existsSync(srcDir) ? srcDir : projectPath)
  return out
}

async function readLastReport(projectPath: string): Promise<RunReport | null> {
  try {
    return JSON.parse(await fs.readFile(lastReportPath(projectPath), 'utf8'))
  } catch {
    return null
  }
}

const hashSnapshotPath = (p: string): string => join(p, '.qa', 'reports', '.source-hashes.json')

/** 모든 소스의 내용 해시 맵 (relpath → sha1). */
async function hashSources(projectPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const abs of await walkSource(projectPath)) {
    try {
      out[relative(projectPath, abs)] = createHash('sha1')
        .update(await fs.readFile(abs))
        .digest('hex')
    } catch {
      /* ignore */
    }
  }
  return out
}

/**
 * 실행 시점의 소스 내용 해시를 저장한다. 이후 getChangeImpact 가 이 스냅샷과 비교해
 * '내용이 진짜 바뀐' 파일만 잡는다(mtime 만 바뀐 건 무시). 테스트 실행 완료 시 호출.
 */
export async function snapshotSourceHashes(projectPath: string): Promise<void> {
  try {
    await fs.mkdir(join(projectPath, '.qa', 'reports'), { recursive: true })
    await fs.writeFile(hashSnapshotPath(projectPath), JSON.stringify(await hashSources(projectPath)), 'utf8')
  } catch {
    /* best-effort */
  }
}

async function readHashSnapshot(projectPath: string): Promise<Record<string, string> | null> {
  try {
    return JSON.parse(await fs.readFile(hashSnapshotPath(projectPath), 'utf8'))
  } catch {
    return null
  }
}

/** spec 텍스트에서 언급된 소스 파일 경로(src/....ts[x]) 를 뽑는다. */
function referencedSources(specText: string): Set<string> {
  const set = new Set<string>()
  for (const m of specText.matchAll(/src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx)/g)) {
    set.add(m[0])
  }
  return set
}

export async function getChangeImpact(projectPath: string): Promise<ChangeImpactReport> {
  const report = await readLastReport(projectPath)
  const lastRunAt = report?.startedAt || null
  const lastRunMs = lastRunAt ? Date.parse(lastRunAt) : NaN

  // Phase 1: 마지막 실행 이후 '내용이 바뀐' 소스.
  // 우선 내용 해시 스냅샷과 비교(정확 — mtime 만 바뀐 건 무시). 스냅샷 없으면 mtime 폴백.
  const changedFiles: string[] = []
  const snapshot = await readHashSnapshot(projectPath)
  if (snapshot) {
    const current = await hashSources(projectPath)
    for (const [rel, h] of Object.entries(current)) {
      if (snapshot[rel] !== h) changedFiles.push(rel) // 새 파일 or 내용 변경
    }
  } else if (lastRunAt && !Number.isNaN(lastRunMs)) {
    // 폴백: 해시 스냅샷이 아직 없으면 mtime 으로(다음 실행 때 스냅샷 생성되어 정확해짐)
    for (const abs of await walkSource(projectPath)) {
      try {
        const st = await fs.stat(abs)
        if (st.mtimeMs > lastRunMs) changedFiles.push(relative(projectPath, abs))
      } catch {
        /* ignore */
      }
    }
  }
  changedFiles.sort()

  // Phase 2: 변경 파일을 커버(언급)하는 spec 매핑
  const affectedSpecs: AffectedSpec[] = []
  if (changedFiles.length > 0) {
    const dir = testsDir(projectPath)
    const specs = existsSync(dir)
      ? (await fs.readdir(dir)).filter((f) => f.endsWith('.spec.ts'))
      : []
    for (const f of specs.sort()) {
      const text = await fs.readFile(join(dir, f), 'utf8').catch(() => '')
      const refs = referencedSources(text)
      const hit = changedFiles.filter((c) => refs.has(c))
      if (hit.length > 0) affectedSpecs.push({ spec: f, changedFiles: hit })
    }
  }

  return { lastRunAt, changedFiles, stale: changedFiles.length > 0, affectedSpecs }
}
