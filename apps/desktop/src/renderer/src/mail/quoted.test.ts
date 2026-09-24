import { describe, expect, it } from 'vitest'
import { splitQuoted } from './quoted'

// Synthetic bodies shaped like HEY's Markdown for real replies.

const gmailReply = [
  'Dear friends,',
  '',
  'The time works for me.',
  '',
  'Warmest regards',
  '',
  'On Tuesday, September 22, 2026 at 09:44:17 PM GMT+3, Ana Lima \\<ana@example.fr\\> wrote:',
  '',
  'Dear Sam,  ',
  '',
  'Thank you for your email.',
].join('\n')

const frenchReply = [
  'Dear Sam,  ',
  'I confirm my participation.  ',
  'Very warmly,  ',
  'Ana  ',
  'Le mardi 22 septembre 2026 à 07:51:48 UTC−7, Example Office \\<office@example.org\\> a écrit :  ',
  'Dear friends,  ',
  'Thank you for confirming.',
].join('\n')

const outlookReply = [
  'Warm regards,',
  '',
  'Sam,',
  '',
  '*On behalf of the Example Office*',
  '',
  '**From:** Example Office  ',
  '**Sent:** Monday, 31 August, 2026 5:47 PM  ',
  '**To:** Ana Lima \\<ana@example.fr\\>  ',
  '**Subject:** Invitation',
  '',
  'Dear friends,',
].join('\n')

const outlookFlattened = [
  'Thanks, see below.  ',
  'From: Example Office Sent: Monday, 31 August, 2026 5:47 PMTo: Ana \\<ana@example.fr\\>Subject: Invitation  ',
  'Dear friends,',
].join('\n')

const gmailForward = [
  'FYI',
  '',
  '\\---------- Forwarded message ---------  ',
  'From: **Example Council** \\<office@example.org\\>  ',
  'Date: Thu, 13 Aug 2026, 11:20  ',
  'Subject: Letter  ',
  '',
  'Body of the forwarded letter.',
].join('\n')

describe('splitQuoted', () => {
  it('cuts a Gmail reply at "On … wrote:" and names who is quoted', () => {
    const r = splitQuoted(gmailReply, true)!
    expect(r.fresh).toBe('Dear friends,\n\nThe time works for me.\n\nWarmest regards')
    expect(r.quoted.startsWith('On Tuesday')).toBe(true)
    expect(r.quotedName).toBe('Ana Lima')
  })

  it('understands other languages', () => {
    const r = splitQuoted(frenchReply, true)!
    expect(r.fresh.endsWith('Ana')).toBe(true)
    expect(r.quotedName).toBe('Example Office')
  })

  it('cuts an Outlook reply at its From/Sent block, keeping the signature', () => {
    const r = splitQuoted(outlookReply, true)!
    expect(r.fresh.endsWith('*On behalf of the Example Office*')).toBe(true)
    expect(r.quotedName).toBe('Example Office')
    expect(splitQuoted(outlookFlattened, true)?.fresh).toBe('Thanks, see below.')
  })

  it('treats an Outlook block in the first message as a forward, not a quote', () => {
    expect(splitQuoted(outlookReply, false)).toBeNull()
  })

  it('never hides a forwarded message', () => {
    expect(splitQuoted(gmailForward, true)).toBeNull()
  })

  it('keeps everything when nothing precedes the quote, or there is none', () => {
    expect(splitQuoted('On Mon, Ana <a@x.com> wrote:\n\n> hi', true)).toBeNull()
    expect(splitQuoted('Just a note.', true)).toBeNull()
  })

  it('does not mistake ordinary sentences for quote intros', () => {
    expect(splitQuoted('On Monday we met.\nShe wrote: great', true)).toBeNull()
    expect(splitQuoted('From: the team, with thanks', true)).toBeNull()
  })
})
