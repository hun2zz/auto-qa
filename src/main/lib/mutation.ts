import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Mutation testing 의 '순수' 부분: 소스에 작은 결함(mutant)을 심는 연산자들과,
 * 유저 소스를 안전하게 백업·복원하는 매니페스트. (오케스트레이션은 runner 에 있음)
 *
 * ⚠️ 이건 유저의 '실제 소스 코드'를 임시로 바꾼다. 그래서 변형 전 원본을
 *   .qa/.mutation-bak/manifest.json 에 저장하고, 프로세스가 중간에 죽어도
 *   다음 실행 시작 때 restoreMutationSources() 로 방어 복원한다.
 */

export interface Mutant {
  /** 프로젝트 기준 상대경로 */
  file: string
  /** 1-based 줄 번호 */
  line: number
  /** 연산자 라벨 (예: "<= → <") */
  operator: string
  /** 변형된 전체 소스(파일 내용) */
  mutatedSource: string
  /** 변형된 줄(표시용) */
  snippet: string
}

/** 한 쌍의 치환 규칙. longer 토큰을 먼저 둬야 `===` 가 `==` 로 오인되지 않는다. */
const OPS: Array<{ from: string; to: string }> = [
  { from: '<=', to: '<' },
  { from: '>=', to: '>' },
  // 경계 비교: 제네릭 Array<T>/JSX <div> 오염을 피하려 '공백으로 감싼' 비교만 변형한다.
  { from: ' < ', to: ' <= ' },
  { from: ' > ', to: ' >= ' },
  { from: '===', to: '!==' },
  { from: '!==', to: '===' },
  { from: '&&', to: '||' },
  { from: '||', to: '&&' }
]
// 단어 경계가 필요한 boolean 리터럴은 별도 처리
const BOOL: Array<{ from: string; to: string }> = [
  { from: 'true', to: 'false' },
  { from: 'false', to: 'true' }
]

/** 라인 내 위치 pos 가 문자열 리터럴 안인지 대략 판정(따옴표 개수 홀짝 휴리스틱). */
function insideString(line: string, pos: number): boolean {
  let q = 0
  for (let i = 0; i < pos; i++) {
    const c = line[i]
    if (c === '"' || c === "'" || c === '`') q++
  }
  return q % 2 === 1
}

function isCommentLine(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/**
 * 소스에서 mutant 목록 생성(결정적). 각 연산자 등장마다 1개 mutant.
 * 문자열/주석 안은 건너뛴다(휴리스틱). JSX 오염을 줄이려 호출측에서 로직 파일만 넘기는 걸 권장.
 */
export function generateMutants(file: string, source: string): Mutant[] {
  const lines = source.split('\n')
  const mutants: Mutant[] = []

  const applyAt = (li: number, col: number, from: string, to: string, label: string): void => {
    const line = lines[li]
    const mutatedLine = line.slice(0, col) + to + line.slice(col + from.length)
    const mutatedSource = [...lines.slice(0, li), mutatedLine, ...lines.slice(li + 1)].join('\n')
    mutants.push({ file, line: li + 1, operator: label, mutatedSource, snippet: mutatedLine.trim() })
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (isCommentLine(line)) continue

    for (const { from, to } of OPS) {
      let idx = line.indexOf(from)
      while (idx !== -1) {
        // `===` 를 처리할 때 `==`(부분집합) 재검출 방지: 앞뒤가 `=`면 스킵
        const prev = line[idx - 1]
        const next = line[idx + from.length]
        const partOfLonger =
          (from === '<=' || from === '>=') && (next === '=' ) // <== 같은 건 없지만 방어
        if (!partOfLonger && !insideString(line, idx)) {
          // === / !== 은 앞뒤에 = 가 더 붙지 않은 정확한 3글자만
          const exactEq =
            (from === '===' || from === '!==') && (prev === '=' || next === '=')
          if (!exactEq) applyAt(li, idx, from, to, `${from} → ${to}`)
        }
        idx = line.indexOf(from, idx + from.length)
      }
    }

    for (const { from, to } of BOOL) {
      const re = new RegExp(`\\b${from}\\b`, 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        if (!insideString(line, m.index)) applyAt(li, m.index, from, to, `${from} → ${to}`)
      }
    }
  }
  return mutants
}

// ── 소스 백업/복원 (크래시 안전) ──────────────────────────────────────────

const bakDir = (projectPath: string): string => join(projectPath, '.qa', '.mutation-bak')
const manifestPath = (projectPath: string): string => join(bakDir(projectPath), 'manifest.json')

/** 대상 파일들의 원본을 매니페스트(relpath→내용)로 저장. 변형 시작 전 1회 호출. */
export async function backupSources(projectPath: string, relFiles: string[]): Promise<void> {
  await fs.mkdir(bakDir(projectPath), { recursive: true })
  const manifest: Record<string, string> = {}
  for (const rel of relFiles) {
    manifest[rel] = await fs.readFile(join(projectPath, rel), 'utf8')
  }
  await fs.writeFile(manifestPath(projectPath), JSON.stringify(manifest), 'utf8')
}

/**
 * 매니페스트에 저장된 원본으로 모든 대상 소스를 되돌리고 매니페스트 삭제.
 * 정상 종료의 최종 복원 + 다음 실행 시작 시 방어 복원(크래시 잔여 정리) 양쪽에서 쓴다.
 * 되돌린 파일 수 반환(0=잔여 없음).
 */
export async function restoreMutationSources(projectPath: string): Promise<number> {
  const mp = manifestPath(projectPath)
  if (!existsSync(mp)) return 0
  let manifest: Record<string, string>
  try {
    manifest = JSON.parse(await fs.readFile(mp, 'utf8'))
  } catch {
    return 0
  }
  let n = 0
  for (const [rel, content] of Object.entries(manifest)) {
    try {
      await fs.writeFile(join(projectPath, rel), content, 'utf8')
      n++
    } catch {
      /* 개별 실패 무시, 나머지 계속 */
    }
  }
  await fs.rm(mp, { force: true }).catch(() => {})
  await fs.rmdir(bakDir(projectPath)).catch(() => {}) // 비었으면 빈 폴더도 정리
  return n
}
