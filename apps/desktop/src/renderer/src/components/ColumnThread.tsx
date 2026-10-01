import { useEffect, useRef, type ReactNode } from 'react'
import type { PostingRow } from '@shared/api'
import { shortDate } from '../format'
import { stripSubjectPrefixes } from '../mail/forwarded'

/**
 * The Column style's open email: unrolled inside the list's column, between the emails
 * around it, which fade back (a click opens one; Esc or the sender line closes it). One
 * column to read down, instead of a list beside a reader.
 */
export function ColumnThread({ list, posting, where, onOpen, onClose, children }: { list: PostingRow[]; posting: PostingRow | null; where: string; onOpen: (p: PostingRow) => void; onClose: () => void; children: ReactNode }) {
  const i = posting ? list.findIndex((p) => p.id === posting.id) : -1
  const before = i < 0 ? [] : list.slice(Math.max(0, i - 2), i)
  const after = i < 0 ? [] : list.slice(i + 1, i + 4)
  const scroller = useRef<HTMLDivElement>(null)
  // Each email starts at its top.
  useEffect(() => {
    // (Chromium's scrollTo returns a promise: never hand it back to React as a clean-up.)
    void scroller.current?.scrollTo({ top: 0 })
  }, [posting?.id])

  return (
    <div ref={scroller} className="scroll min-h-0 flex-1">
      <div className="column-thread mx-auto w-full max-w-[760px] px-14 pt-5 pb-24">
        {before.map((p) => (
          <Neighbour key={p.id} posting={p} onOpen={onOpen} />
        ))}
        <section className="column-open relative" data-unread={posting && !posting.seen ? true : undefined}>
          {/* Where you are, and the way back (the message's own header says who and when). */}
          <div className="flex items-baseline gap-4 font-meta text-[12px] text-ink-faint">
            <button type="button" onClick={onClose} title="Back to the list (Esc)" className="flex flex-1 items-baseline gap-2 text-left hover:text-ink-soft">
              <span>{where}</span>
              {i >= 0 && <span>· {i + 1} of {list.length}</span>}
            </button>
            <span>esc closes</span>
          </div>
          {children}
        </section>
        {after.map((p) => (
          <Neighbour key={p.id} posting={p} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

/** An email around the open one: faded back until you point at it. */
function Neighbour({ posting: p, onOpen }: { posting: PostingRow; onOpen: (p: PostingRow) => void }) {
  return (
    <button type="button" onClick={() => onOpen(p)} className="column-neighbour block w-full py-3 text-left opacity-35 transition-opacity duration-(--dur-1) hover:opacity-80" data-unread={!p.seen || undefined}>
      <span className="flex items-baseline gap-3">
        <span className={`truncate text-[14px] ${p.seen ? 'text-ink-soft' : 'font-semibold text-ink'}`}>{p.senderName ?? p.senderEmail}</span>
        <span className="flex-1" />
        <span className="font-meta text-[12px] text-ink-faint">{shortDate(p.activeAt)}</span>
      </span>
      <span className="mt-0.5 block truncate font-title text-[17px] text-ink-soft">{p.subject ? stripSubjectPrefixes(p.isBundle ? p.subject.split(' • ')[0]! : p.subject) : '(no subject)'}</span>
    </button>
  )
}
