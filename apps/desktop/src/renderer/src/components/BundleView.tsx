import type { PostingRow } from '@shared/api'
import { api, useLive } from '../api'
import { dayAndTime } from '../format'
import { stripSubjectPrefixes } from '../mail/forwarded'
import { Avatar } from './Avatar'

/**
 * A bundle opened: one sender's unread threads, newest first, as HEY shows them. Choosing
 * one opens it like any thread; the bundle's row in the list brings this back.
 */
export function BundleView({ bundleId, sender, onOpen }: { bundleId: number; sender: string; onOpen: (p: PostingRow) => void }) {
  const threads = useLive(() => api.bundleThreads(bundleId), [bundleId])

  const list = threads.data ?? []
  return (
    <div className="mt-6">
      <p className="text-[13px] text-ink-faint">
        {threads.loading && !threads.data ? 'Loading…' : `${list.length} new ${list.length === 1 ? 'email' : 'emails'} from ${sender}, bundled`}
      </p>
      {threads.error && <p className="mt-3 text-danger">Couldn't load this bundle: {threads.error}</p>}
      <ul className="mt-3 overflow-hidden rounded-ui-lg border border-rule bg-pane">
        {list.map((t, i) => {
          const { day, time } = dayAndTime(t.activeAt ?? '')
          return (
            <li key={t.id} className={i ? 'border-t border-rule' : ''}>
              <button onClick={() => onOpen(t)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-pane-alt">
                <Avatar avatar={t.avatar} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{stripSubjectPrefixes(t.subject) || '(no subject)'}</span>
                  {t.summary && <span className="mt-0.5 block truncate text-[12.5px] text-ink-faint">{t.summary}</span>}
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-faint">
                  {day}, {time}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
