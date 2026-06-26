import { useEffect, useRef, type JSX } from 'react'
import type { ProgressPhase } from '@shared/types'
import { useStore } from '../store'
import { TerminalIcon, ChevronIcon, Spinner } from './icons'

const PHASE_LABEL: Record<ProgressPhase, string> = {
  analyze: '요구사항 분석',
  checklist: '체크리스트 생성',
  tests: '테스트 코드 생성',
  devserver: 'dev 서버 구동',
  playwright: 'Playwright 실행',
  idle: '대기'
}

export function ProgressConsole(): JSX.Element {
  const busy = useStore((s) => s.busy)
  const phase = useStore((s) => s.phase)
  const phaseMessage = useStore((s) => s.phaseMessage)
  const fraction = useStore((s) => s.fraction)
  const log = useStore((s) => s.log)
  const open = useStore((s) => s.consoleOpen)
  const toggle = useStore((s) => s.toggleConsole)

  const scrollRef = useRef<HTMLDivElement>(null)

  // 새 로그가 들어오면 자동 스크롤
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [log, open])

  const consoleLines = log.filter((l) => l.log || l.message)

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      {/* 상태 헤더 바 */}
      <button
        type="button"
        onClick={toggle}
        className="no-drag flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-2/40"
      >
        <span
          className={[
            'flex h-6 w-6 items-center justify-center rounded-md',
            busy ? 'bg-brand/20 text-brand-soft' : 'bg-surface-2 text-muted'
          ].join(' ')}
        >
          {busy ? <Spinner className="h-3.5 w-3.5" /> : <TerminalIcon width={14} height={14} />}
        </span>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={[
              'text-xs font-semibold',
              busy ? 'text-brand-soft' : 'text-muted'
            ].join(' ')}
          >
            {busy ? PHASE_LABEL[phase] : '진행 콘솔'}
          </span>
          {busy && (
            <span className="truncate text-xs text-muted">
              {phaseMessage}
              <AnimatedDots />
            </span>
          )}
          {!busy && phaseMessage && (
            <span className="truncate text-xs text-muted">{phaseMessage}</span>
          )}
        </div>

        {busy && typeof fraction === 'number' && (
          <span className="shrink-0 font-mono text-[11px] text-muted">
            {Math.round(fraction * 100)}%
          </span>
        )}

        <ChevronIcon
          width={16}
          height={16}
          className={`shrink-0 text-muted transition-transform duration-200 ${open ? '' : 'rotate-180'}`}
        />
      </button>

      {/* 진행률 바 (busy 일 때만) */}
      {busy && (
        <div className="h-0.5 w-full overflow-hidden bg-surface-2">
          {typeof fraction === 'number' ? (
            <div
              className="h-full bg-brand transition-all duration-300"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          ) : (
            <div className="indeterminate h-full w-1/3 bg-brand" />
          )}
        </div>
      )}

      {/* 콘솔 로그 */}
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-out"
        style={{ maxHeight: open ? 180 : 0 }}
      >
        <div
          ref={scrollRef}
          className="h-[180px] overflow-y-auto bg-bg px-5 py-3 font-mono text-[11.5px] leading-relaxed"
        >
          {consoleLines.length === 0 ? (
            <p className="text-muted/70">진행 로그가 여기에 표시됩니다.</p>
          ) : (
            consoleLines.map((l) => (
              <div key={l.id} className="flex gap-2 whitespace-pre-wrap break-words">
                <span className="shrink-0 select-none text-muted/50">
                  {new Date(l.at).toLocaleTimeString('ko-KR', { hour12: false })}
                </span>
                <span className="shrink-0 select-none text-brand-soft/70">
                  [{PHASE_LABEL[l.phase]}]
                </span>
                <span
                  className={
                    l.error ? 'text-bad/90' : l.done ? 'text-ok/90' : 'text-text/80'
                  }
                >
                  {l.log ?? l.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .indeterminate { animation: indeterminate 1.2s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

function AnimatedDots(): JSX.Element {
  return (
    <span className="inline-flex">
      <span className="dot1">.</span>
      <span className="dot2">.</span>
      <span className="dot3">.</span>
      <style>{`
        @keyframes blink { 0%,100%{opacity:0.2} 50%{opacity:1} }
        .dot1{animation:blink 1.2s infinite 0s}
        .dot2{animation:blink 1.2s infinite 0.2s}
        .dot3{animation:blink 1.2s infinite 0.4s}
      `}</style>
    </span>
  )
}
