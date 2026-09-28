import type { ReactNode } from 'react'

/**
 * A tag: one look wherever one appears (lists, the reader, Today). Small capitals, and a
 * kind that says what it is:
 * - `action`: the sender flags it as needing you ("Action required"), and To do items;
 * - `reply`: it needs your reply;
 * - `label`: a HEY label you gave it;
 * - `list`: a mailing list's tag from the subject;
 * - `plain`: what sort of thing it is (Appointment, Form), when nothing about it is pressing.
 */
export type TagKind = 'action' | 'reply' | 'label' | 'list' | 'plain'

const KINDS: Record<TagKind, string> = {
  action: 'bg-attn-wash text-attn',
  reply: 'bg-accent-wash text-accent',
  label: 'border border-rule-strong text-ink-soft',
  list: 'border border-dashed border-rule-strong text-ink-faint',
  plain: 'bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] text-ink-soft',
}

export function Tag({ kind, title, children }: { kind: TagKind; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`tag inline-flex shrink-0 items-center rounded-[3px] px-[5px] text-[10px] leading-[15px] font-semibold tracking-[0.05em] whitespace-nowrap uppercase ${KINDS[kind]}`}>
      {children}
    </span>
  )
}
