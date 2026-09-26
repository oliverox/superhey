import { z } from 'zod'

// Schemas are loose: they check the fields the app relies on and pass everything else
// through, so a new CLI field never breaks parsing.

const nullish = <T extends z.ZodType>(t: T) => t.nullish()

/**
 * HEY timestamps are UTC, but `thread read` prints some without a zone ("2026-08-13T07:21"),
 * which JavaScript would read as local time. Adds the missing seconds and "Z".
 */
export function normalizeUtc(value: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/.exec(value)
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}Z` : value
}
const utc = z.string().transform(normalizeUtc)

export const Contact = z.looseObject({
  id: z.number(),
  name: nullish(z.string()),
  email_address: nullish(z.string()),
  contactable_type: nullish(z.string()),
})
export type Contact = z.infer<typeof Contact>

export const Box = z.looseObject({
  id: z.number(),
  kind: z.string(),
  name: z.string(),
})
export type Box = z.infer<typeof Box>

export const Posting = z.looseObject({
  id: z.number(),
  // A bundle row names a sender rather than a thread and can omit topic_id.
  topic_id: nullish(z.number()),
  box_id: nullish(z.number()),
  /** "topic" for a thread; "bundle" for one sender's unread mail rolled into a row. */
  kind: nullish(z.string()),
  name: z.string().default(''),
  // HEY sends `seen: true` or leaves it out; absent means unseen.
  seen: nullish(z.boolean()),
  bubbled_up: nullish(z.boolean()),
  created_at: nullish(z.string()),
  active_at: nullish(z.string()),
  updated_at: nullish(z.string()),
  summary: nullish(z.string()),
  visible_entry_count: nullish(z.number()),
  includes_attachments: nullish(z.boolean()),
  alternative_sender_name: nullish(z.string()),
  creator: nullish(Contact),
  contacts: nullish(z.array(Contact)),
  folders: nullish(z.array(z.looseObject({ id: z.number(), name: z.string() }))),
  app_url: nullish(z.string()),
})
export type Posting = z.infer<typeof Posting>

export const BoxView = z.looseObject({
  id: z.number(),
  kind: z.string(),
  name: z.string(),
  next_page: nullish(z.string()),
  postings: z.array(Posting),
})
export type BoxView = z.infer<typeof BoxView>

export const Recipients = z.looseObject({
  to: z.array(Contact).default([]),
  cc: z.array(Contact).default([]),
  bcc: z.array(Contact).default([]),
})

export const Entry = z.looseObject({
  id: z.number(),
  kind: nullish(z.string()),
  created_at: utc,
  body: z.string().default(''),
  summary: nullish(z.string()),
  creator: nullish(Contact),
  // The actual From address when HEY recorded one separately from the creator.
  sender: nullish(Contact),
  recipients: nullish(Recipients),
})
export type Entry = z.infer<typeof Entry>

export const Thread = z.array(Entry)

export const Sender = z.looseObject({
  id: z.number(),
  email: z.string(),
})

export const Calendar = z.looseObject({
  id: z.number(),
  name: nullish(z.string()),
  kind: z.string(),
  color: nullish(z.string()),
})
export type Calendar = z.infer<typeof Calendar>

export const CalendarEvent = z.looseObject({
  id: z.number(),
  title: z.string().default(''),
  starts_at: z.string(),
  ends_at: nullish(z.string()),
  all_day: nullish(z.boolean()),
  occurrence_id: nullish(z.string()),
  parent_id: nullish(z.number()),
  recording_id: nullish(z.number()),
  location: nullish(z.string()),
  url: nullish(z.string()),
  calendar: nullish(z.looseObject({ id: z.number(), name: nullish(z.string()), color: nullish(z.string()) })),
})
export type CalendarEvent = z.infer<typeof CalendarEvent>

export const Todo = z.looseObject({
  id: z.number(),
  title: z.string().default(''),
  starts_at: nullish(z.string()),
  completed_at: nullish(z.string()),
})
export type Todo = z.infer<typeof Todo>

export const Attachment = z.looseObject({
  // "<message id>:<n>" for a direct attachment; "<message id>:e-…" for a file embedded in the HTML.
  id: z.string(),
  message_id: z.number(),
  filename: z.string(),
  content_type: nullish(z.string()),
  byte_size: nullish(z.number()),
})
export type Attachment = z.infer<typeof Attachment>

export const SavedAttachment = z.looseObject({
  id: z.string(),
  path: z.string(),
})

/** One thread `hey search` found: its box item, subject and the messages that matched. */
export const SearchResult = z.looseObject({
  // The box item; missing for a thread that's in no box HEY lists (it can still be read).
  id: nullish(z.number()),
  topic_id: z.number(),
  subject: z.string().default(''),
  updated_at: utc,
  messages: z
    .array(
      z.looseObject({
        id: z.number(),
        created_at: nullish(utc),
        summary: nullish(z.string()),
        alternative_sender_name: nullish(z.string()),
        app_url: nullish(z.string()),
        creator: nullish(
          z.looseObject({
            name: nullish(z.string()),
            email_address: nullish(z.string()),
            avatar_url: nullish(z.string()),
            avatar_background_color: nullish(z.string()),
            initials: nullish(z.string()),
          }),
        ),
      }),
    )
    .default([]),
})
export type SearchResult = z.infer<typeof SearchResult>

export const Bundle = z.looseObject({
  id: z.number(),
  postings: z.array(Posting).default([]),
})

/** Someone waiting in The Screener; `id` is the clearance ID the decisions take. */
export const ScreenerEntry = z.looseObject({
  id: z.number(),
  name: nullish(z.string()),
  email_address: z.string(),
  subject: nullish(z.string()),
  summary: nullish(z.string()),
  topic_id: nullish(z.number()),
})
export type ScreenerEntry = z.infer<typeof ScreenerEntry>

export const Named = z.looseObject({ id: z.number(), name: z.string() })

/** One line of `hey watch` output. */
export const WatchLine = z.looseObject({
  change: z.string(),
  at: nullish(z.string()),
  box: nullish(z.looseObject({ id: z.number(), kind: z.string(), name: z.string() })),
  posting_id: nullish(z.number()),
  thread_id: nullish(z.number()),
  new: nullish(z.boolean()),
  posting: nullish(Posting),
})
export type WatchLine = z.infer<typeof WatchLine>
