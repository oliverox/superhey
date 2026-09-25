import { describe, expect, it } from 'vitest'
import type { PostingRow } from '@shared/api'
import { accept, completing, mergeResults, splitMatches, suggestions } from './search'

describe('completing', () => {
  it('finds an operator value being typed', () => {
    expect(completing('invoice from:wi')).toEqual({ kind: 'value', op: 'from', value: 'wi', start: 8 })
    expect(completing('from:"Sam L')).toEqual({ kind: 'value', op: 'from', value: 'Sam L', start: 0 })
    expect(completing('has:')).toEqual({ kind: 'value', op: 'has', value: '', start: 0 })
    expect(completing('-in:fe')).toMatchObject({ op: 'in', value: 'fe' })
  })

  it('finds an operator name being typed, but not a finished word', () => {
    expect(completing('invoice fro')).toEqual({ kind: 'operator', prefix: 'fro', start: 8 })
    expect(completing('ne')).toMatchObject({ kind: 'operator', prefix: 'ne' })
    expect(completing('invoice ')).toBeNull()
    expect(completing('invoice')).toBeNull()
    expect(completing('meeting 10:30')).toBeNull()
    expect(completing('f')).toBeNull()
  })
})

describe('suggestions', () => {
  it('suggests operators by name', () => {
    expect(suggestions(completing('ne')).map((s) => s.insert)).toEqual(['newer_than:'])
    expect(suggestions(completing('su'))[0]).toMatchObject({ label: 'subject:', hint: 'Words in the subject' })
  })

  it('suggests fixed choices, matching by value or label', () => {
    expect(suggestions(completing('has:p')).map((s) => s.insert)).toEqual(['has:pdf', 'has:presentation'])
    expect(suggestions(completing('in:reply')).map((s) => s.insert)).toEqual(['in:later'])
    expect(suggestions(completing('is:')).map((s) => s.label)).toEqual(['Unread', 'Read'])
  })

  it('suggests the people and labels it’s given', () => {
    const people = [{ name: 'Sam Lee', email: 'sam@example.com' }, { name: null, email: 'noreply@wise.com' }]
    expect(suggestions(completing('to:sa'), people)).toEqual([
      { label: 'Sam Lee', hint: 'sam@example.com', insert: 'to:sam@example.com' },
      { label: 'noreply@wise.com', hint: undefined, insert: 'to:noreply@wise.com' },
    ])
    expect(suggestions(completing('label:tr'), [], ['Travel plans', 'BnB', 'Trips']).map((s) => s.insert)).toEqual(['label:"Travel plans"', 'label:Trips'])
  })

  it('accepts a suggestion in place of what’s typed', () => {
    const c = completing('invoice fro')!
    expect(accept('invoice fro', c, suggestions(c)[0]!)).toBe('invoice from:')
    const v = completing('invoice has:p')!
    expect(accept('invoice has:p', v, suggestions(v)[0]!)).toBe('invoice has:pdf ')
  })
})

describe('mergeResults', () => {
  const row = (id: number, topicId: number, activeAt: string, boxId = 1) => ({ id, topicId, activeAt, boxId }) as PostingRow
  it('keeps one row per thread, the cache’s, newest first', () => {
    const merged = mergeResults([row(1, 91, '2026-09-25T09:00:00Z')], [row(1, 91, '2026-09-25T09:00:00Z', 0), row(7, 97, '2026-09-26T09:00:00Z', 0), row(8, 98, '2025-01-01T09:00:00Z', 0)])
    expect(merged.map((r) => [r.id, r.boxId])).toEqual([[7, 0], [1, 1], [8, 0]])
  })
})

describe('splitMatches', () => {
  it('marks matching words, longest first, case-insensitively and safely', () => {
    expect(splitMatches('Transfer sent to Wise', ['wise', 'transfer'])).toEqual([
      { text: 'Transfer', match: true },
      { text: ' sent to ', match: false },
      { text: 'Wise', match: true },
    ])
    expect(splitMatches('Price (USD) up', ['(usd)'])).toEqual([{ text: 'Price ', match: false }, { text: '(USD)', match: true }, { text: ' up', match: false }])
    expect(splitMatches('abc', [])).toEqual([{ text: 'abc', match: false }])
  })
})
