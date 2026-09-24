import { afterEach, describe, expect, it, vi } from 'vitest'
import { Outbox, type OutgoingRecord } from '../src/actions/outbox'
import { HeyClient } from '../src/cli/client'
import { HeyRunner } from '../src/cli/runner'
import { TopicId } from '../src/ids'
import { fakeExec, ok } from './fixtures'

afterEach(() => vi.useRealTimers())

function setup(routes: Parameters<typeof fakeExec>[0] = [['compose', ok({ id: 77 })], ['forward', ok({})]]) {
  const fake = fakeExec(routes)
  const client = new HeyClient(new HeyRunner({ binary: 'hey', exec: fake.exec }))
  const outbox = new Outbox(client, 5000)
  const seen: string[] = []
  outbox.on('outgoing', (r: OutgoingRecord) => seen.push(r.status))
  return { outbox, calls: fake.calls, seen }
}

const reply = { to: ['ana@example.com'], cc: ['bo@example.com'], body: 'Friday works.\n\nSam', threadId: TopicId(900), attach: ['/tmp/plan.pdf'] }

describe('Outbox', () => {
  it('holds a message for the undo window, then sends it with the right flags', async () => {
    vi.useFakeTimers()
    const { outbox, calls, seen } = setup()
    outbox.send(reply, 'reply-all')
    await vi.advanceTimersByTimeAsync(4999)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls[0]).toEqual([
      'compose', '--thread-id', '900', '--to', 'ana@example.com', '--cc', 'bo@example.com',
      '-m', 'Friday works.\n\nSam', '--attach', '/tmp/plan.pdf', '--json',
    ])
    expect(seen).toEqual(['pending', 'sending', 'sent'])
  })

  it('never contacts HEY when undone in time, and hands the message back', async () => {
    vi.useFakeTimers()
    const { outbox, calls } = setup()
    const r = outbox.send(reply, 'reply')
    await vi.advanceTimersByTimeAsync(3000)
    const back = outbox.cancel(r.id)
    expect(back).toMatchObject({ status: 'cancelled', message: reply })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(0)
    expect(() => outbox.cancel(r.id)).toThrow(/Too late/)
  })

  it('refuses to undo once the message has gone', async () => {
    vi.useFakeTimers()
    const { outbox } = setup()
    const r = outbox.send(reply, 'reply')
    await vi.advanceTimersByTimeAsync(5000)
    expect(() => outbox.cancel(r.id)).toThrow(/Too late to undo: the message is sent/)
  })

  it('sends new messages with a subject, and forwards through forward', async () => {
    vi.useFakeTimers()
    const { outbox, calls } = setup()
    outbox.send({ to: ['a@x.com'], subject: 'Lunch', body: 'Free Friday?', from: 'me@hey.example' }, 'new')
    outbox.send({ to: ['b@x.com'], body: 'FYI' }, 'forward', TopicId(900))
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toContainEqual(['compose', '--subject', 'Lunch', '--to', 'a@x.com', '--from', 'me@hey.example', '-m', 'Free Friday?', '--json'])
    expect(calls).toContainEqual(['forward', '900', '--to', 'b@x.com', '-m', 'FYI', '--json'])
  })

  it('keeps a failed message, with the reason, so nothing is lost', async () => {
    vi.useFakeTimers()
    const { outbox } = setup([['compose', { stdout: '{"ok":false,"code":"usage","error":"invalid recipient"}', stderr: '', exitCode: 2 }]])
    const r = outbox.send(reply, 'reply')
    await vi.advanceTimersByTimeAsync(5000)
    expect(outbox.get(r.id)).toMatchObject({ status: 'failed', error: 'invalid recipient', message: reply })
  })

  it('never delivers when sending is disabled (test instances)', async () => {
    vi.useFakeTimers()
    const fake = fakeExec([['compose', ok({ id: 1 })]])
    const outbox = new Outbox(new HeyClient(new HeyRunner({ binary: 'hey', exec: fake.exec })), 5000, true)
    const r = outbox.send(reply, 'reply')
    await vi.advanceTimersByTimeAsync(5000)
    expect(fake.calls).toHaveLength(0)
    expect(outbox.get(r.id)).toMatchObject({ status: 'failed', error: 'Sending is disabled in this test instance' })
  })

  it('saves drafts straight away and returns the draft ID', async () => {
    const { outbox, calls } = setup()
    expect(await outbox.saveDraft(reply)).toBe(77)
    expect(calls[0]!.at(-2)).toBe('--draft')
  })
})
