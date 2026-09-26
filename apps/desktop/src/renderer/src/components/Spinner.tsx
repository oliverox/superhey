/** A small spinning ring for work in progress, in the current text colour. */
export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={`spinner shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
