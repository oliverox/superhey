import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { AiClient } from '../src/ai/client'
import { readAiSettings } from '../src/ai/settings'
import { openDb } from '../src/cache/db'
import { Repo, type PostingRow } from '../src/cache/repo'
import { BriefingDeduper, briefingThings, foldDuplicates } from '../src/today/dedupe'
import type { ActionItem, ComingUpItem, TodayView } from '../src/today/today'

const post = (id: number, subject = 'Reservation for Catching Waves Retreat') =>
  ({ id, topicId: id * 10, subject, senderName: 'Airbnb', senderEmail: 'automated@airbnb.com' }) as unknown as PostingRow
const action = (p: PostingRow, n: number, text: string, due = '2026-10-15'): ActionItem => ({ key: `action:${p.id}:${n}`, posting: p, text, due, daysLate: 0, kind: 'task', amount: null })
const date = (p: PostingRow, label: string, d = '2026-10-17', task: string | null = null): ComingUpItem => ({ key: `date:${p.id}:${label}`, posting: p, label, date: d, time: null, isDeadline: false, task })
const view = (actions: ActionItem[], comingUp: ComingUpItem[] = []) =>
  ({ due: { todos: [], actions, bubbled: [] }, comingUp, toHandle: actions.length } as unknown as TodayView)

const airbnb = post(1)
const checkIn = action(airbnb, 0, 'Check in at Catching Waves Retreat')
const water = action(airbnb, 1, 'Buy water containers upon arrival')
const prepare = action(airbnb, 2, 'Prepare for guest check-in')

describe('folding the Briefing', () => {
  it('folds rows found to be the same into the kept one, which clears them all', () => {
    const v = view([checkIn, water, prepare])
    const [a, , c] = briefingThings(v).map((t) => t.key)
    const out = foldDuplicates(v, [[c!, a!]])
    expect(out.due.actions.map((x) => x.text)).toEqual(['Prepare for guest check-in', 'Buy water containers upon arrival'])
    expect(out.due.actions[0]!.merged).toEqual({
      emails: 1,
      items: [
        { topicId: 10, text: 'Prepare for guest check-in' },
        { topicId: 10, text: 'Check in at Catching Waves Retreat' },
      ],
    })
    expect(out.toHandle).toBe(2)
  })

  it('keeps a to-do due now in Due, taking in the same thing coming up', () => {
    const reminder = post(2, 'Your trip is coming up')
    const v = view([checkIn], [date(reminder, 'Check-in at the retreat', '2026-10-15'), date(reminder, 'Surf lesson')])
    const keys = briefingThings(v).map((t) => t.key)
    const out = foldDuplicates(v, [[keys[1]!, keys[0]!]])
    expect(out.due.actions).toHaveLength(1)
    expect(out.due.actions[0]!.text).toBe('Check-in at the retreat')
    expect(out.due.actions[0]!.merged!.items).toContainEqual({ topicId: 20, text: 'Check-in at the retreat' })
    expect(out.due.actions[0]!.merged!.emails).toBe(2)
    expect(out.comingUp.map((c) => c.label)).toEqual(['Surf lesson'])
  })

  it('a date that stood for a calendar event, folded into Due, takes the event with it', () => {
    const reminder = post(3, 'Call tonight')
    const call = { ...date(reminder, 'Prep call', '2026-10-15'), time: '18:00', calendar: { title: 'OPD prep call' } as never }
    const v = view([checkIn], [call])
    const keys = briefingThings(v).map((t) => t.key)
    expect(foldDuplicates(v, [[keys[0]!, keys[1]!]]).due.actions[0]!.calendar?.title).toBe('OPD prep call')
  })

  it('ignores answers about rows no longer there', () => {
    const v = view([checkIn, water])
    expect(foldDuplicates(v, [['due|10|gone', 'due|10|also gone']])).toBe(v)
  })
})

function setup(answer: string) {
  const repo = new Repo(openDb(':memory:'))
  const prompts: string[] = []
  const m = new MockLanguageModelV4({
    doGenerate: async (call) => {
      prompts.push(JSON.stringify(call.prompt))
      return {
        content: [{ type: 'text', text: answer }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 500, noCache: 500, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
        warnings: [],
      } as never
    },
  })
  const ai = new AiClient({ settings: () => readAiSettings({}), apiKey: (p) => (p === 'claude' ? 'sk-ant-test' : null), repo, model: () => m })
  return { repo, deduper: new BriefingDeduper({ repo, ai }), prompts }
}

describe('asking which rows are the same', () => {
  it('asks once per set of rows, and folds by the answer from then on', async () => {
    const { deduper, prompts } = setup('{"groups":[{"ids":[1,3],"keep":1}]}')
    const v = view([checkIn, water, prepare])
    let folded = 0
    deduper.on('folded', () => folded++)
    await deduper.ask(briefingThings(v))
    expect(prompts[0]).toContain('1. Due 2026-10-15: Check in at Catching Waves Retreat (from Airbnb')
    expect(folded).toBe(1)
    expect(deduper.apply(v).due.actions.map((a) => a.text)).toEqual(['Check in at Catching Waves Retreat', 'Buy water containers upon arrival'])
  })

  it('a later answer about the same rows replaces the earlier one', async () => {
    const first = setup('{"groups":[{"ids":[1,2],"keep":1}]}')
    const v = view([checkIn, water])
    await first.deduper.ask(briefingThings(v))
    expect(first.deduper.apply(v).due.actions).toHaveLength(1)
    const again = new BriefingDeduper({ repo: first.repo, ai: new AiClient({ settings: () => readAiSettings({}), apiKey: () => 'k', repo: first.repo, model: () => setupModel('{"groups":[]}') }) })
    await again.ask(briefingThings(view([checkIn, water, prepare])))
    expect(again.apply(v).due.actions).toHaveLength(2)
  })
})

function setupModel(answer: string) {
  return new MockLanguageModelV4({
    doGenerate: async () =>
      ({
        content: [{ type: 'text', text: answer }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      }) as never,
  })
}
