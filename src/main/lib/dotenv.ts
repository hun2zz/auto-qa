import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// 로드 순서: 뒤가 앞을 덮어씀(Next 의 .env.local 우선과 동일)
const ENV_FILES = ['.env', '.env.local']

/**
 * 타겟 프로젝트의 .env / .env.local 을 파싱해 환경변수 맵으로 반환.
 * (의존성 없는 경량 파서 — KEY=VALUE, 따옴표·주석 처리. production 빌드/서버 실행에
 *  DATABASE_URL 등 프로젝트 환경변수를 주입하기 위함.)
 */
export function loadProjectEnv(projectPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of ENV_FILES) {
    const p = join(projectPath, f)
    if (!existsSync(p)) continue
    let text = ''
    try {
      text = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/)
      if (!m) continue
      let v = m[2].trim()
      // 인라인 주석 제거(따옴표 밖일 때만)는 단순화: 따옴표로 감싼 경우만 그대로
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      out[m[1]] = v
    }
  }
  return out
}
