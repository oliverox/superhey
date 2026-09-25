import { describe, expect, it, vi } from 'vitest'
import { fuzzyMatch } from './fuzzy'
import { rank, type Command } from './model'

const cmd = (title: string, over: Partial<Command> = {}): Command => ({ id: title, section: 'Actions', title, run: vi.fn(), ...over })
const titles = (q: string, list: Command[], recent: string[] = []) => rank(q, list, recent).map((r) => r.command.title)

describe('fuzzyMatch', () => {
  it('matches characters in order and rejects the rest', () => {
    expect(fuzzyMatch('rpl', 'Reply Later')).not.toBeNull()
    expect(fuzzyMatch('tl', 'Reply Later')).toBeNull() // no l after the t
    expect(fuzzyMatch('xyz', 'Reply Later')).toBeNull()
  })

  it('prefers word starts: "rl" is Reply Later, highlighting R and L', () => {
    expect(fuzzyMatch('rl', 'Reply Later')?.indices).toEqual([0, 6])
    expect(fuzzyMatch('pt', 'Move to Paper Trail')?.indices).toEqual([8, 14])
  })

  it('ignores case and accents, keeping indices on the original text', () => {
    const m = fuzzyMatch('cafe', "Café World News")
    expect(m).not.toBeNull()
    expect(m!.indices[0]).toBe(0)
    expect(fuzzyMatch('ZURICH', 'Zürich')).not.toBeNull()
  })

  it('scores a prefix over a word start over a scattered match', () => {
    const prefix = fuzzyMatch('rep', 'Reply')!.score
    const word = fuzzyMatch('rep', 'Quick reply')!.score
    const scattered = fuzzyMatch('rep', 'Raise the price')!.score
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(scattered)
  })

  it('treats spaces in the query as word breaks', () => {
    expect(fuzzyMatch('move trail', 'Move to Paper Trail')).not.toBeNull()
    expect(fuzzyMatch('  ', 'Anything')).toEqual({ score: 0, indices: [] })
  })
})

describe('rank', () => {
  const list = [
    cmd('Reply Later', { keys: ['r'] }),
    cmd('Reply', { keys: ['R'] }),
    cmd('Move to Paper Trail', { keywords: ['receipts'] }),
    cmd('Go to Reply Later', { section: 'Go to' }),
    cmd('Switch theme', { section: 'App' }),
    cmd('Stripe payout', { section: 'Emails', id: 'email:1' }),
  ]

  it('puts the closest title first, whatever the section', () => {
    expect(titles('reply', list)[0]).toBe('Reply')
    expect(titles('rl', list)[0]).toBe('Reply Later')
    expect(titles('theme', list)).toEqual(['Switch theme'])
  })

  it('finds commands by their keywords, below title matches', () => {
    expect(titles('receipts', list)).toEqual(['Move to Paper Trail'])
    const withTitle = [...list, cmd('Receipts', { section: 'Labels' })]
    expect(titles('receipts', withTitle)).toEqual(['Receipts', 'Move to Paper Trail'])
  })

  it('with nothing typed, lists recent choices first, then sections in order, and no emails', () => {
    const r = rank('', list, ['Switch theme'])
    expect(r[0]!.command).toMatchObject({ title: 'Switch theme', section: 'Recent' })
    expect(r.map((x) => x.command.section)).toEqual(['Recent', 'Actions', 'Actions', 'Actions', 'Go to'])
  })

  it('nudges recent choices up among equal matches', () => {
    const pair = [cmd('Label: Travel', { section: 'Labels' }), cmd('Label: Taxes', { section: 'Labels' })]
    expect(titles('label t', pair, ['Label: Taxes'])[0]).toBe('Label: Taxes')
  })

  it('ignores recent ids that no longer exist', () => {
    expect(rank('', [cmd('Reply')], ['gone', 'Reply']).map((r) => r.command.title)).toEqual(['Reply'])
  })
})
