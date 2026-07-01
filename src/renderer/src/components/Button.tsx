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
  // Vercel 스타일: 프라이머리 = 흰 배경/검정 글자
  primary: 'bg-white text-black hover:bg-white/90 active:translate-y-px',
  secondary:
    'bg-transparent text-text border border-border hover:border-muted/60 hover:bg-surface-2 active:translate-y-px',
  ghost: 'text-muted hover:text-text hover:bg-surface-2 active:translate-y-px',
  success: 'bg-ok/15 text-ok border border-ok/40 hover:bg-ok/25 active:translate-y-px'
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-[13px] gap-2 rounded-md',
  lg: 'h-10 px-4 text-sm gap-2 rounded-lg'
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
