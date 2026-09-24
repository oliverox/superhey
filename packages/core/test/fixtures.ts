// Synthetic data shaped like HEY CLI output. Never commit real mail here.
import type { Exec, ExecResult } from '../src/cli/runner'

export const alice = { id: 11, name: 'Alice Example', email_address: 'alice@example.com', contactable_type: 'Person' }
export const me = { id: 1, name: 'Me', email_address: 'me@hey.example', contactable_type: 'User' }

export function posting(over: Record<string, unknown> = {}) {
  return {
    id: 100,
    topic_id: 900,
    box_id: 1,
    name: 'Lunch on Friday?',
    summary: 'Are you free?',
    created_at: '2026-09-20T10:00:00Z',
    active_at: '2026-09-20T10:00:00Z',
    visible_entry_count: 1,
    creator: alice,
    contacts: [alice],
    app_url: 'https://app.hey.com/topics/900',
    ...over,
  }
}

export function entry(over: Record<string, unknown> = {}) {
  return {
    id: 5000,
    kind: 'message',
    created_at: '2026-09-20T10:00:00Z',
    body: 'Are you free for lunch on Friday at the harbour?',
    creator: alice,
    sender: null,
    recipients: { to: [me], cc: [], bcc: [] },
    ...over,
  }
}

export const ok = (data: unknown): ExecResult => ({
  stdout: JSON.stringify({ ok: true, data }),
  stderr: '',
  exitCode: 0,
})

/** An Exec that answers by matching the joined args against a table of prefixes. */
export function fakeExec(routes: Array<[prefix: string, result: ExecResult | (() => ExecResult)]>) {
  const calls: string[][] = []
  const exec: Exec = async (_bin, args) => {
    calls.push(args)
    const joined = args.join(' ')
    const hit = routes.find(([prefix]) => joined.startsWith(prefix))
    if (!hit) throw new Error(`unexpected call: hey ${joined}`)
    return typeof hit[1] === 'function' ? hit[1]() : hit[1]
  }
  return { exec, calls }
}
