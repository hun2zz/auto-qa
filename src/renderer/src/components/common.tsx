import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { ChevronIcon } from './icons'

export interface MenuItem {
  label: string
  onClick: () => void
  icon?: ReactNode
  loading?: boolean
}

/** 보조 액션을 담는 드롭다운 메뉴 (버튼 클러터 정리용) */
export function Menu({
  label,
  items,
  icon
}: {
  label: string
  items: MenuItem[]
  icon?: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-2"
      >
        {icon}
        {label}
        <ChevronIcon
          width={14}
          height={14}
          className={`text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 min-w-[190px] rounded-lg border border-border bg-surface p-1 shadow-[0_10px_38px_-10px_rgba(0,0,0,0.8)]">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              disabled={it.loading}
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {it.icon && <span className="shrink-0 text-muted">{it.icon}</span>}
              <span className="flex-1 truncate">{it.label}</span>
              {it.loading && <span className="text-[10px] text-muted">…</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 패널 상단 헤더 (제목 + 설명 + 우측 액션) */
export function PanelHeader({
  step,
  title,
  desc,
  action
}: {
  step: number
  title: string
  desc: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 px-8 pt-7 pb-5">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-soft">
          STEP {step}
        </p>
        <h2 className="text-xl font-semibold tracking-tight text-text">{title}</h2>
        <p className="mt-1 text-sm text-muted">{desc}</p>
      </div>
      {action && <div className="shrink-0 pt-1">{action}</div>}
    </div>
  )
}

/** 빈 상태 안내 */
export function EmptyState({
  icon,
  title,
  desc,
  action
}: {
  icon: ReactNode
  title: string
  desc: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface/40 px-8 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-muted ring-1 ring-border">
        {icon}
      </div>
      <h3 className="text-base font-medium text-text">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted">{desc}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

type BadgeTone = 'ok' | 'warn' | 'bad' | 'brand' | 'muted'

const BADGE_TONES: Record<BadgeTone, string> = {
  ok: 'bg-ok/15 text-ok ring-ok/30',
  warn: 'bg-warn/15 text-warn ring-warn/30',
  bad: 'bg-bad/15 text-bad ring-bad/30',
  brand: 'bg-brand/15 text-brand-soft ring-brand/30',
  muted: 'bg-surface-2 text-muted ring-border'
}

export function Badge({
  tone = 'muted',
  children,
  icon
}: {
  tone?: BadgeTone
  children: ReactNode
  icon?: ReactNode
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${BADGE_TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  )
}

/** 스크롤 가능한 패널 본문 컨테이너 */
export function PanelBody({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex-1 overflow-y-auto px-8 pb-10">{children}</div>
}
