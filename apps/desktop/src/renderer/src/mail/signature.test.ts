import { describe, expect, it } from 'vitest'
import { repeatedSignatures } from './signature'

const sig = `Sam Lee
Head of Partnerships, Example Org
+230 555 0100 · 12 Harbour Road, Port Louis`

const msg = (id: number, text: string, sender: string | null = 'sam@example.org') => ({ id, sender, text })
const folded = (text: string, cut: number | undefined) => (cut == null ? null : text.slice(cut))

describe('repeated signatures', () => {
  it('folds the lines that end every message from the same sender, keeping sign-off and name', () => {
    const a = `Friday works for me.\n\nBest regards,\n${sig}\n`
    const b = `Here is the agenda.\n\nBest regards,\n${sig}`
    const cuts = repeatedSignatures([msg(1, a), msg(2, b)])
    expect(folded(a, cuts.get(1))).toBe('Head of Partnerships, Example Org\n+230 555 0100 · 12 Harbour Road, Port Louis\n')
    expect(folded(b, cuts.get(2))).toBe('Head of Partnerships, Example Org\n+230 555 0100 · 12 Harbour Road, Port Louis')
  })

  it('folds a signature without a sign-off from its first repeated line', () => {
    const block = 'Office of Public Affairs\nTel. +230 555 0199\nwww.example.org'
    const a = `First note.\n${block}`
    const b = `Second note, longer.\n${block}`
    const cuts = repeatedSignatures([msg(1, a), msg(2, b)])
    expect(folded(a, cuts.get(1))).toBe(block)
  })

  it('leaves it alone when it appears once, is short, or is the whole message', () => {
    expect(repeatedSignatures([msg(1, `Hi.\n${sig}`)]).size).toBe(0)
    expect(repeatedSignatures([msg(1, 'Yes.\nThanks,\nSam'), msg(2, 'No.\nThanks,\nSam')]).size).toBe(0)
    expect(repeatedSignatures([msg(1, sig), msg(2, `Hello\n${sig}`)]).has(1)).toBe(false)
  })

  it('compares only within one sender, ignoring spacing', () => {
    const other = `Sure.\n${sig}`
    expect(repeatedSignatures([msg(1, `A.\n${sig}`), msg(2, other, 'ana@example.org')]).size).toBe(0)
    const spaced = `B.\n${sig.replace('Head of', 'Head  of')}`
    expect(repeatedSignatures([msg(1, `A.\n${sig}`), msg(2, spaced)]).size).toBe(2)
  })
})
