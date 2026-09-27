import type { PostingRow } from '@shared/api'
import { api } from '../api'

/**
 * "Mark read" on an unread row, shown while the row is hovered (or focused): over the end of
 * the row, on a fade of its colour, so it takes no room at rest. Not for bundles.
 */
export function MarkRead({ posting: p }: { posting: PostingRow }) {
  if (p.seen || p.isBundle || p.id <= 0) return null
  return (
    <span className="row-actions pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-r-ui pr-2 pl-10 opacity-0 transition-opacity duration-(--dur-1) group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
      <button
        onClick={(e) => {
          e.stopPropagation()
          void api.runAction({ type: 'seen', postingId: p.id, seen: true })
        }}
        title="Mark as read without opening it"
        className="inline-flex items-center gap-1.5 rounded-ui bg-pane px-2.5 py-1 text-[12px] font-medium text-ink-soft shadow-[0_0_0_1px_var(--rule-strong)] hover:text-ink"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m3 8.5 3.5 3.5L13 4.5" />
        </svg>
        Mark read
      </button>
    </span>
  )
}
