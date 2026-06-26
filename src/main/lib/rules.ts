import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RuleFile } from '@shared/types'
import { qaDir } from './projectManager'

/**
 * 가드레일 규칙을 '단계별로 쪼개서' 관리한다 (무신사식).
 * 한 덩어리로 다 주입하지 않고, 각 AI 단계(phase)에 해당하는 규칙만 합쳐 주입 →
 * 토큰 효율 + 지시 준수율 향상.
 */
export type RulePhase = 'checklist' | 'tests' | 'auth' | 'healing'

const rulesDir = (p: string): string => join(qaDir(p), 'rules')

interface DefaultRule {
  name: string
  scope: string // 'all' 또는 'checklist,tests' 처럼 쉼표 구분
  body: string
}

const DEFAULTS: DefaultRule[] = [
  {
    name: '00-global.md',
    scope: 'all',
    body: `# 전역 규칙 (모든 단계 공통)
1. 프로덕션 소스코드를 절대 수정하지 않는다. 오직 .qa/ 안의 테스트·문서만 생성·수정한다.
2. 거짓 통과 금지: 통과시키려고 assertion 을 약화·삭제·주석처리하지 않는다.
3. 셀렉터·기대값을 추측하지 않는다. 프로젝트 코드에서 실제로 확인한다.`
  },
  {
    name: '10-checklist.md',
    scope: 'checklist',
    body: `# 체크리스트 작성 규칙
- 항목 5~15개. 핵심 플로우 + 주요 에러 케이스를 포함한다.
- 각 항목은 하나의 '관찰 가능한 결과'만 검증한다. 막연한 표현("잘 동작") 금지.
- 셀렉터 힌트는 코드에서 확인한 것만 적고, 없으면 "(확인 필요)" 로 표기한다.`
  },
  {
    name: '20-tests.md',
    scope: 'tests,healing',
    body: `# Playwright 테스트 규칙
- 셀렉터 우선순위: getByRole > getByLabel > getByTestId > getByText. CSS/xpath 는 최후수단.
- 불필요한 wait/sleep 금지. web-first assertion(auto-waiting)을 사용한다.
- 셀렉터를 코드에서 확정 못 한 항목은 test.fixme() 로 두고 사유를 주석에 남긴다.
- 테스트 제목은 체크리스트 항목과 1:1 로 대응시킨다.`
  },
  {
    name: '30-healing.md',
    scope: 'healing',
    body: `# self-healing 규칙
- 셀렉터 변화로 깨진 것만 고친다. assertion 의 '검증 의도'는 절대 바꾸지 않는다.
- 셀렉터 문제가 아니라 '실제 기능 버그'로 보이면 고치지 말고 REAL_BUG 로 표시한다.`
  },
  {
    name: '40-auth.md',
    scope: 'auth',
    body: `# 로그인 셋업 규칙
- 비밀번호 등 비밀값을 파일에 하드코딩 금지. 오직 process.env 참조.
- 로그인 성공 신호를 expect 로 확인한 뒤 storageState 를 저장한다.`
  },
  {
    name: '90-domain.md',
    scope: 'all',
    body: `# 도메인 규칙 (프로젝트에 맞게 추가)
- (예: 결제·발송 등 부수효과 있는 플로우는 테스트 계정·시드데이터만 사용)
- (예: 로그인은 storageState 재사용)`
  }
]

function serialize(scope: string, body: string): string {
  return `---\nscope: ${scope}\n---\n\n${body.trim()}\n`
}

/** frontmatter 의 scope 와 본문 분리 */
function parse(raw: string): { scope: string; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { scope: 'all', body: raw.trim() }
  const scopeLine = m[1].split('\n').find((l) => /^scope\s*:/.test(l))
  const scope = scopeLine ? scopeLine.replace(/^scope\s*:/, '').trim() : 'all'
  return { scope: scope || 'all', body: m[2].trim() }
}

function scopeMatches(scope: string, phase: RulePhase): boolean {
  const parts = scope
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
  return parts.includes('all') || parts.includes(phase)
}

/** rules 폴더 보장 + 기본 규칙 생성 (레거시 RULES.md 가 있으면 도메인 규칙으로 흡수) */
export async function ensureRules(projectPath: string): Promise<void> {
  const dir = rulesDir(projectPath)
  if (existsSync(dir)) return
  await fs.mkdir(dir, { recursive: true })

  // 레거시 단일 RULES.md → 90-domain.md 로 이전
  const legacy = join(qaDir(projectPath), 'RULES.md')
  let domainBody = DEFAULTS.find((d) => d.name === '90-domain.md')!.body
  if (existsSync(legacy)) {
    const prev = await fs.readFile(legacy, 'utf8').catch(() => '')
    if (prev.trim()) domainBody = `# 도메인 규칙 (이전 RULES.md 에서 이전됨)\n\n${prev.trim()}`
    await fs.rm(legacy).catch(() => {})
  }

  for (const d of DEFAULTS) {
    const body = d.name === '90-domain.md' ? domainBody : d.body
    await fs.writeFile(join(dir, d.name), serialize(d.scope, body), 'utf8')
  }
}

/** 해당 phase 에 적용되는 규칙만 합쳐서 반환 (없으면 빈 문자열) */
export async function composeRules(projectPath: string, phase: RulePhase): Promise<string> {
  const dir = rulesDir(projectPath)
  if (!existsSync(dir)) return ''
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  const blocks: string[] = []
  for (const f of files) {
    const raw = await fs.readFile(join(dir, f), 'utf8').catch(() => '')
    const { scope, body } = parse(raw)
    if (body && scopeMatches(scope, phase)) blocks.push(body)
  }
  return blocks.join('\n\n')
}

/** UI 용: 규칙 파일 목록 */
export async function listRules(projectPath: string): Promise<RuleFile[]> {
  await ensureRules(projectPath)
  const dir = rulesDir(projectPath)
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  const out: RuleFile[] = []
  for (const name of files) {
    const raw = await fs.readFile(join(dir, name), 'utf8').catch(() => '')
    const { scope } = parse(raw)
    out.push({ name, scope, content: raw })
  }
  return out
}

export async function saveRule(projectPath: string, name: string, content: string): Promise<void> {
  if (!/^[\w.-]+\.md$/.test(name)) throw new Error('잘못된 규칙 파일명입니다.')
  await ensureRules(projectPath)
  await fs.writeFile(join(rulesDir(projectPath), name), content, 'utf8')
}
