import type { JSX } from 'react'

type IconProps = JSX.IntrinsicElements['svg']

const base = (props: IconProps): IconProps => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...props
})

export const FolderIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />
  </svg>
)

export const DocIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h6" />
  </svg>
)

export const ChecklistIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="m9 11 3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
)

export const FlaskIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M9 3h6M10 3v6.5L5 19a1.5 1.5 0 0 0 1.3 2.3h11.4A1.5 1.5 0 0 0 19 19l-5-9.5V3" />
    <path d="M7.5 15h9" />
  </svg>
)

export const PlayIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="m6 3 14 9-14 9Z" />
  </svg>
)

export const GearIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
)

export const UploadIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5M12 3v12" />
  </svg>
)

export const SparkleIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
)

export const CheckIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const ChevronIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const CloseIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const TerminalIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="m4 17 6-6-6-6M12 19h8" />
  </svg>
)

export const TrashIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6m4 5v6m4-6v6" />
  </svg>
)

export const AlertIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

/** 작은 회전 스피너 */
export const Spinner = ({ className = '' }: { className?: string }): JSX.Element => (
  <svg
    className={`animate-spin ${className}`}
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
)
