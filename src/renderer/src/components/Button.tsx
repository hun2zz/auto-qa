import type { JSX, ReactNode } from 'react'
import { Spinner } from './icons'

type Variant = 'primary' | 'secondary' | 'ghost' | 'success'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  loadingText?: string
  icon?: ReactNode
  className?: string
  title?: string
  type?: 'button' | 'submit'
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-white hover:bg-brand-soft active:translate-y-px shadow-[0_4px_14px_-4px_rgba(99,102,241,0.6)]',
  secondary:
    'bg-surface-2 text-text border border-border hover:border-brand/60 hover:bg-surface-2/70 active:translate-y-px',
  ghost: 'text-muted hover:text-text hover:bg-surface-2 active:translate-y-px',
  success:
    'bg-ok/15 text-ok border border-ok/40 hover:bg-ok/25 active:translate-y-px'
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl'
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  loadingText,
  icon,
  className = '',
  title,
  type = 'button'
}: ButtonProps): JSX.Element {
  const isDisabled = disabled || loading
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={isDisabled}
      className={[
        'no-drag inline-flex items-center justify-center font-medium select-none',
        'transition-all duration-150 ease-out outline-none',
        'focus-visible:ring-2 focus-visible:ring-brand/60',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0',
        SIZES[size],
        VARIANTS[variant],
        className
      ].join(' ')}
    >
      {loading ? <Spinner /> : icon}
      <span className="truncate">{loading && loadingText ? loadingText : children}</span>
    </button>
  )
}
