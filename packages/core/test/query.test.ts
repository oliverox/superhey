import { describe, expect, it } from 'vitest'
import { highlightTerms, isEmptyQuery, operatorValue, parseQuery, withOperator } from '../src/search/query'

const TODAY = new Date(2026, 8, 25)
const p = (s: string) => parseQuery(s, TODAY)

describe('parseQuery', () => {
  it('reads words, "phrases", -excluded words and OR groups', () => {
    expect(p('quarterly report')).toMatchObject({ words: ['quarterly', 'report'] })
    expect(p('"round table" -draft -"out of office"')).toMatchObject({ phrases: ['round table'], excluded: ['draft', 'out of office'], words: [] })
    expect(p('invoice OR receipt OR bill paid')).toMatchObject({ anyOf: [['invoice', 'receipt', 'bill']], words: ['paid'] })
    expect(p('{flight hotel} booking')).toMatchObject({ anyOf: [['flight', 'hotel']], words: ['booking'] })
    // Lowercase "or" is a word, as in Gmail.
    expect(p('this or that')).toMatchObject({ words: ['this', 'or', 'that'], anyOf: [] })
  })

  it('reads operators, with quoted values', () => {
    expect(p('from:wise to:"Sam Lee" subject:transfer label:BnB')).toMatchObject({ from: 'wise', to: 'Sam Lee', subject: 'transfer', label: 'BnB', words: [] })
    expect(p('FROM:Wise')).toMatchObject({ from: 'Wise' })
  })

  it('names boxes the way people do', () => {
    expect(p('in:feed').box).toBe('feedbox')
    expect(p('in:paper-trail').box).toBe('trailbox')
    expect(p('in:"reply later"').box).toBe('laterbox')
    expect(p('in:inbox').box).toBe('imbox')
    expect(p('in:somewhere')).toMatchObject({ box: null, problems: ['in:somewhere'] })
  })

  it('maps has: to HEY’s attachment kinds', () => {
    expect(p('has:attachment').attachment).toBe('any')
    expect(p('has:pdf').attachment).toBe('pdfs')
    expect(p('has:spreadsheet').attachment).toBe('spreadsheets')
    expect(p('has:invite').attachment).toBe('calendar_invites')
    expect(p('has:wings')).toMatchObject({ attachment: null, problems: ['has:wings'] })
  })

  it('reads read state and dates, absolute and relative', () => {
    expect(p('is:unread').read).toBe(false)
    expect(p('is:read').read).toBe(true)
    expect(p('after:2026/09/01 before:2026-09-20')).toMatchObject({ after: '2026-09-01', before: '2026-09-20' })
    expect(p('after:1/9/2026').after).toBe('2026-09-01')
    expect(p('after:2025').after).toBe('2025-01-01')
    expect(p('newer_than:7d').after).toBe('2026-09-18')
    expect(p('newer_than:2w').after).toBe('2026-09-11')
    expect(p('older_than:1y').before).toBe('2025-09-25')
    expect(p('newer_than:3m').after).toBe('2026-06-25')
    expect(p('after:2026-02-30 newer_than:soon').problems).toEqual(['after:2026-02-30', 'newer_than:soon'])
  })

  it('keeps words that only look like operators', () => {
    expect(p('meeting at 10:30 https://example.com').words).toEqual(['meeting', 'at', '10:30', 'https://example.com'])
    // An operator still being typed asks for nothing yet.
    expect(isEmptyQuery(p('from:'))).toBe(true)
    expect(p('wise from:').words).toEqual(['wise'])
  })

  it('knows an empty query and what to highlight', () => {
    expect(isEmptyQuery(p('   '))).toBe(true)
    expect(isEmptyQuery(p('is:unread'))).toBe(false)
    expect(highlightTerms(p('deposit "sweet rate" {eur usd} subject:transfer from:wise -spam a'))).toEqual(['deposit', 'sweet rate', 'eur', 'usd', 'transfer'])
  })
})

describe('editing the query text', () => {
  it('sets, replaces and removes an operator', () => {
    expect(withOperator('deposit', 'from', 'wise')).toBe('deposit from:wise')
    expect(withOperator('deposit from:wise', 'from', 'Sam Lee')).toBe('deposit from:"Sam Lee"')
    expect(withOperator('from:"Sam Lee" deposit has:pdf', 'from', null)).toBe('deposit has:pdf')
    expect(withOperator('', 'is', 'unread')).toBe('is:unread')
  })

  it('reads an operator’s value', () => {
    expect(operatorValue('deposit from:"Sam Lee"', 'from')).toBe('Sam Lee')
    expect(operatorValue('has:pdf', 'has')).toBe('pdf')
    expect(operatorValue('deposit', 'from')).toBeNull()
  })
})
