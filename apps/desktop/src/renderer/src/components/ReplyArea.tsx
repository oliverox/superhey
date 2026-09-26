import { useState } from 'react'
import type { ThreadView } from '@shared/api'
import { displayName, replyRecipients, shortName } from '../mail/people'
import { useShortcut, withShortcut } from '../shortcuts'
import { api } from '../api'
import { Composer, type ComposeRequest } from './Composer'
import { DraftCard, DraftRequest, useDraft } from './DraftReply'

/**
 * Under a conversation: Reply (⇧R), Reply all (a) and Forward (⇧F). The composer opens in
 * place, addressed the way HEY would, with every recipient visible and editable.
 */
export function ReplyArea({
  thread,
  keys = true,
}: {
  thread: ThreadView
  /** Whether ⇧R, a and ⇧F act on this thread (in a bundle, only the email in focus). */
  keys?: boolean
}) {
  const [request, setRequest] = useState<ComposeRequest | null>(null)
  const [asking, setAsking] = useState(false)
  const draft = useDraft(thread.topicId).data ?? null
  const latest = thread.entries.at(-1)
  // A draft outdated by the user's own reply has nothing left to answer.
  const shownDraft = draft && !(draft.stale && latest?.from?.isMe) ? draft : null
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

  useShortcut('reply', () => open('reply'), keys && !request && !!latest)
  useShortcut('replyAll', () => open('reply-all'), keys && !request && !!latest)
  useShortcut('forward', () => open('forward'), keys && !request && !!latest)

  // Send the draft as it is: a reply to the sender, through the outbox (a few seconds to undo).
  const sendTo = latest?.from && !latest.from.isMe ? shortName(latest.from) : undefined
  const sendDraft = async (body: string) => {
    if (!latest) return
    const { to, cc } = replyRecipients(latest, 'reply')
    if (!to.length) throw new Error('No one to send it to: use Edit')
    await api.sendMessage({ to, cc, body, threadId: thread.topicId }, 'reply', null)
    await api.discardDraft(thread.topicId)
  }

  const useDraftText = (body: string) => {
    if (!latest || !shownDraft) return
    const who = latest.from ? (latest.from.isMe ? 'your message' : displayName(latest.from)) : 'the thread'
    const { to, cc } = replyRecipients(latest, 'reply')
    setRequest({ kind: 'reply', message: { to, cc, body, threadId: thread.topicId }, context: `to ${who}`, fresh: true })
    // From here the text is the composer's (kept on this device until sent or discarded).
    void api.discardDraft(thread.topicId)
  }

  if (!latest) return null
  if (request) {
    return (
      <div className="mt-5">
        <Composer request={request} variant="inline" onClose={() => setRequest(null)} />
      </div>
    )
  }
  return (
    <>
    {asking ? (
      <DraftRequest thread={thread} initial={shownDraft?.instruction ?? ''} onDone={() => setAsking(false)} onCancel={() => setAsking(false)} />
    ) : (
      shownDraft && <DraftCard draft={shownDraft} sendTo={sendTo} onSend={sendDraft} onUse={useDraftText} onRedraft={() => setAsking(true)} onDiscard={() => void api.discardDraft(thread.topicId)} />
    )}
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
      {!asking && !shownDraft && (
        <ReplyButton onClick={() => setAsking(true)} title="Draft a reply in your voice">
          Draft reply
        </ReplyButton>
      )}
    </div>
    </>
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
