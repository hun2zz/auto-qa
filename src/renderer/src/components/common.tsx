import type { JSX, ReactNode } from 'react'

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
