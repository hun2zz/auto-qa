import { useEffect, type JSX } from 'react'
import { useStore, type Toast } from '../store'
import { CheckIcon, AlertIcon, CloseIcon } from './icons'

export function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

const TONE: Record<Toast['kind'], { ring: string; icon: JSX.Element; text: string }> = {
  success: {
    ring: 'border-ok/40',
    text: 'text-ok',
    icon: <CheckIcon width={16} height={16} strokeWidth={2.5} />
  },
  error: {
    ring: 'border-bad/40',
    text: 'text-bad',
    icon: <AlertIcon width={16} height={16} />
  },
  info: {
    ring: 'border-brand/40',
    text: 'text-brand-soft',
    icon: <AlertIcon width={16} height={16} />
  }
}

function ToastItem({ toast }: { toast: Toast }): JSX.Element {
  const dismiss = useStore((s) => s.dismissToast)

  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), 5000)
    return () => clearTimeout(id)
  }, [toast.id, dismiss])

  const tone = TONE[toast.kind]
  return (
    <div
      className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-surface px-4 py-3 shadow-xl animate-[toastIn_0.2s_ease-out] ${tone.ring}`}
    >
      <span className={`mt-0.5 shrink-0 ${tone.text}`}>{tone.icon}</span>
      <p className="min-w-0 flex-1 break-words text-[13px] leading-snug text-text">{toast.text}</p>
      <button
        onClick={() => dismiss(toast.id)}
        className="shrink-0 text-muted transition-colors hover:text-text"
      >
        <CloseIcon width={14} height={14} />
      </button>
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateX(16px) } to { opacity: 1; transform: none } }`}</style>
    </div>
  )
}
