import { useState } from 'react'
import type { AttachmentRow, PostingRow, ThreadView } from '@shared/api'
import { api, useLive } from '../api'
import { shortDate } from '../format'
import { dedupe, shortName, type Addr } from '../mail/people'
import { extension, formatBytes, visibleAttachments } from './Attachments'
import { AddressRow } from './People'

const PEOPLE_PREVIEW = 6

/**
 * Beside the email when the window is wide: who is involved, what else they've sent,
 * and every file in the thread. The AI summary, drafts and actions will join it later.
 */
export function ContextPanel({ thread, onOpenThread }: { thread: ThreadView; onOpenThread: (p: PostingRow) => void }) {
  const entries = thread.entries
  // Latest sender who isn't you: the person this thread is "with".
  const counterpart = [...entries].reverse().find((e) => e.from && !e.from.isMe)?.from ?? null
  const files = entries.flatMap((e) => visibleAttachments(e.attachments))

  return (
    <aside aria-label="Thread details" className="scroll w-[296px] shrink-0 border-l border-rule bg-pane px-4 pt-6 pb-10 text-[13px]">
      <People thread={thread} />
      {counterpart && <MoreFrom person={counterpart} topicId={thread.topicId} onOpen={onOpenThread} />}
      {files.length > 0 && <Files files={files} />}
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="eyebrow mb-1.5 px-2">{title}</h2>
      {children}
    </section>
  )
}

function People({ thread }: { thread: ThreadView }) {
  const [all, setAll] = useState(false)
  // Senders first (newest first), then everyone else they wrote to. You're left out.
  const senders = [...thread.entries].reverse().flatMap((e) => (e.from ? [e.from] : []))
  const others = thread.entries.flatMap((e) => [...e.to, ...e.cc])
  const people = dedupe([...senders, ...others] as Addr[]).filter((p) => !p.isMe)
  if (!people.length) return null
  const shown = all ? people : people.slice(0, PEOPLE_PREVIEW)

  return (
    <Section title={`People · ${people.length}`}>
      {shown.map((p) => (
        <AddressRow key={p.email} person={p} />
      ))}
      {people.length > PEOPLE_PREVIEW && (
        <button onClick={() => setAll(!all)} className="mt-0.5 px-2 text-[12px] font-medium text-ink-faint hover:text-ink-soft">
          {all ? 'Show fewer' : `Show all ${people.length}`}
        </button>
      )}
    </Section>
  )
}

function MoreFrom({ person, topicId, onOpen }: { person: Addr; topicId: number; onOpen: (p: PostingRow) => void }) {
  const threads = useLive(
    () => api.senderThreads(person.email, topicId),
    [person.email, topicId],
    (e) => e.type === 'change' && e.change.kind === 'postings',
  )
  if (!threads.data?.length) return null

  return (
    <Section title={`More from ${shortName(person)}`}>
      <ul>
        {threads.data.map((p) => (
          <li key={p.id}>
            <button onClick={() => onOpen(p)} className="flex w-full items-baseline gap-2 rounded-ui px-2 py-1.5 text-left hover:bg-pane-alt">
              <span className="min-w-0 flex-1 truncate text-ink">{p.subject || '(no subject)'}</span>
              <span className="shrink-0 text-[11.5px] text-ink-faint">{shortDate(p.activeAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Files({ files }: { files: AttachmentRow[] }) {
  return (
    <Section title={`Files · ${files.length}`}>
      <ul>
        {files.map((f) => (
          <li key={f.id}>
            <FileRow file={f} />
          </li>
        ))}
      </ul>
    </Section>
  )
}

function FileRow({ file }: { file: AttachmentRow }) {
  const [failed, setFailed] = useState(false)
  return (
    <button
      onClick={() => api.openAttachment(file.id).then(() => setFailed(false), () => setFailed(true))}
      title={failed ? "Couldn't open" : `Open ${file.filename}`}
      className="flex w-full items-center gap-2.5 rounded-ui px-2 py-1.5 text-left hover:bg-pane-alt"
    >
      <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded-[3px] bg-pane-sunk text-[9px] font-semibold tracking-wide text-ink-soft uppercase">
        {extension(file.filename) || 'file'}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{file.filename}</span>
      <span className={`shrink-0 text-[11.5px] ${failed ? 'text-danger' : 'text-ink-faint'}`}>{failed ? 'Failed' : formatBytes(file.byteSize)}</span>
    </button>
  )
}
