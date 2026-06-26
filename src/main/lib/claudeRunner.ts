import { spawn } from 'node:child_process'
import type { ProgressEvent, ProgressPhase } from '@shared/types'

/**
 * Claude Code(CLI)를 헤드리스(`claude -p`)로 spawn 하는 래퍼.
 *
 * 인증/과금: ANTHROPIC_API_KEY 가 환경에 없으면 `claude login` 으로 로그인된
 * 구독(Pro/Max)을 사용한다. 사내 도구이므로 기본적으로 API 키를 스크럽해
 * 구독 인증 경로를 강제한다(scrubApiKey).
 *
 * 동작 방식: claude 가 자체 Write/Edit/Read 툴로 .qa/ 안에 결과 파일을 직접
 * 쓰게 하고, 우리는 완료까지 진행상황을 스트리밍한 뒤 파일을 다시 읽는다.
 */

export interface RunClaudeOptions {
  /** cwd 이자 --add-dir 대상 (타겟 프로젝트 루트) */
  projectPath: string
  /** 모델에게 보낼 프롬프트 (stdin 으로 전달) */
  prompt: string
  /** 허용 툴 (예: ['Read','Grep','Glob'] 또는 ['Read','Write','Edit']) */
  allowedTools: string[]
  /** 권한 모드 — 무인 실행은 'acceptEdits' */
  permissionMode?: 'acceptEdits' | 'plan' | 'default' | 'bypassPermissions'
  /** 진행상황 표시용 phase */
  phase: ProgressPhase
  /** 에이전트 반복 상한 (폭주 방지) */
  maxTurns?: number
  /** 진행 이벤트 콜백 */
  onProgress?: (e: ProgressEvent) => void
  /** true면 ANTHROPIC_API_KEY 를 자식 env 에서 제거해 구독 인증 강제 (기본 true) */
  scrubApiKey?: boolean
  /** 외부 취소 신호 */
  signal?: AbortSignal
}

export interface RunClaudeResult {
  ok: boolean
  /** 최종 result 텍스트 (모델의 요약) */
  summary: string
  /** USD 비용 (구독 사용 시에도 환산값 제공됨) */
  costUsd?: number
  sessionId?: string
  /** 비정상 종료 시 사유 */
  error?: string
}

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude'

export function runClaude(opts: RunClaudeOptions): Promise<RunClaudeResult> {
  const {
    projectPath,
    prompt,
    allowedTools,
    permissionMode = 'acceptEdits',
    phase,
    maxTurns = 40,
    onProgress,
    scrubApiKey = true,
    signal
  } = opts

  return new Promise((resolve) => {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--add-dir',
      projectPath,
      '--allowedTools',
      allowedTools.join(','),
      '--permission-mode',
      permissionMode,
      '--max-turns',
      String(maxTurns)
    ]

    const env = { ...process.env }
    if (scrubApiKey) delete env.ANTHROPIC_API_KEY

    const child = spawn(CLAUDE_BIN, args, {
      cwd: projectPath,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal
    })

    let finalSummary = ''
    let costUsd: number | undefined
    let sessionId: string | undefined
    let isError = false
    let stdoutBuf = ''
    let stderrTail = ''

    const emit = (e: Partial<ProgressEvent>): void =>
      onProgress?.({ phase, message: e.message ?? '', ...e })

    // 프롬프트는 stdin 으로 (argv 길이 제한/이스케이프 이슈 회피)
    child.stdin.write(prompt)
    child.stdin.end()

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim()
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (!line) continue
        handleStreamLine(line)
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000)
    })

    function handleStreamLine(line: string): void {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        return // 부분 JSON / 비JSON 라인 무시
      }
      const type = msg.type as string

      if (type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id as string
        emit({ message: '세션 시작…', log: 'claude session init' })
        return
      }

      if (type === 'assistant') {
        // 어시스턴트 메시지의 텍스트/툴사용을 진행 로그로
        const message = msg.message as { content?: unknown[] } | undefined
        const content = message?.content ?? []
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === 'text' && typeof block.text === 'string') {
            const text = block.text.trim()
            if (text) emit({ message: firstLine(text), log: text })
          } else if (block.type === 'tool_use') {
            emit({
              message: `툴 사용: ${block.name as string}`,
              log: `→ ${block.name as string}(${shortInput(block.input)})`
            })
          }
        }
        return
      }

      if (type === 'result') {
        isError = Boolean(msg.is_error)
        finalSummary = (msg.result as string) ?? ''
        costUsd = msg.total_cost_usd as number | undefined
        if (!sessionId) sessionId = msg.session_id as string
        return
      }
    }

    child.on('error', (err) => {
      const message =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `'claude' 실행 파일을 찾을 수 없습니다. Claude Code 가 설치/로그인 됐는지 확인하세요.`
          : err.message
      emit({ message, error: true, done: true })
      resolve({ ok: false, summary: '', error: message })
    })

    child.on('close', (code) => {
      const ok = code === 0 && !isError
      emit({
        message: ok ? '완료' : `실패 (code ${code})`,
        done: true,
        error: !ok
      })
      resolve({
        ok,
        summary: finalSummary,
        costUsd,
        sessionId,
        error: ok ? undefined : isError ? finalSummary || stderrTail : stderrTail || `exit ${code}`
      })
    })
  })
}

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return (i === -1 ? s : s.slice(0, i)).slice(0, 160)
}

function shortInput(input: unknown): string {
  try {
    const s = JSON.stringify(input)
    return s.length > 80 ? s.slice(0, 80) + '…' : s
  } catch {
    return ''
  }
}
