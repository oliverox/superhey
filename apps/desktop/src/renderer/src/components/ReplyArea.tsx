import { useState } from 'react'
import type { ThreadView } from '@shared/api'
import { displayName, replyRecipients } from '../mail/people'
import { useShortcut, withShortcut } from '../shortcuts'
import { Composer, type ComposeRequest } from './Composer'

/**
 * Under a conversation: Reply (⇧R), Reply all (a) and Forward (⇧F). The composer opens in
 * place, addressed the way HEY would, with every recipient visible and editable.
 */
export function ReplyArea({ thread }: { thread: ThreadView }) {
  const [request, setRequest] = useState<ComposeRequest | null>(null)
  const latest = thread.entries.at(-1)
  const others = latest ? [latest.from, ...latest.to, ...latest.cc].filter((p) => p && !p.isMe).length : 0

  const open = (kind: 'reply' | 'reply-all' | 'forward') => {
    if (!latest) return
    const who = latest.from ? (latest.from.isMe ? 'your message' : displayName(latest.from)) : 'the thread'
    if (kind === 'forward') {
      setRequest({ kind, message: { to: [], body: '' }, forwardOf: thread.topicId, context: `“${thread.subject ?? ''}”` })
    } else {
      const { to, cc } = replyRecipients(latest, kind)
      setRequest({ kind, message: { to, cc, body: '', threadId: thread.topicId }, context: `to ${who}` })
    }
  }

  useShortcut('reply', () => open('reply'), !request && !!latest)
  useShortcut('replyAll', () => open('reply-all'), !request && !!latest)
  useShortcut('forward', () => open('forward'), !request && !!latest)

  if (!latest) return null
  if (request) {
    return (
      <div className="mt-5">
        <Composer request={request} variant="inline" onClose={() => setRequest(null)} />
      </div>
    )
  }
  return (
    <div className="mt-5 flex gap-2">
      <ReplyButton onClick={() => open('reply')} title={withShortcut('Reply', 'reply')}>
        Reply
      </ReplyButton>
      {others > 1 && (
        <ReplyButton onClick={() => open('reply-all')} title={withShortcut('Reply all', 'replyAll')}>
          Reply all
        </ReplyButton>
      )}
      <ReplyButton onClick={() => open('forward')} title={withShortcut('Forward', 'forward')}>
        Forward
      </ReplyButton>
    </div>
  )
}

function ReplyButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-ui border border-rule bg-pane px-3.5 py-1.5 text-[13px] font-medium text-ink-soft hover:border-rule-strong hover:text-ink"
    >
      {children}
    </button>
  )
}
