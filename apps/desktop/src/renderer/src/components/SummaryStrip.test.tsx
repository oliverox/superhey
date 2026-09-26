// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let analysis: unknown = null
let Reader: typeof import('./Reader')
beforeAll(async () => {
  window.bridge = { call: async (m) => (m === 'analysis' ? analysis : null), onEvent: () => () => {} }
  Reader = await import('./Reader')
})
let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
})

describe('the summary under the title', () => {
  it('shows the AI’s line with what matters as tags, and opens the details', async () => {
    analysis = {
      summary: 'Gathering in Addis Ababa, Nov 22–29; prep call Oct 12 at 5 PM.',
      needsReply: true,
      replyReason: 'asks if you can join',
      dates: [{ label: 'Prep call', date: '2099-10-12', time: '17:00' }, { label: 'Gathering', date: '2099-11-22', endDate: '2099-11-29', time: null }, { label: 'Long ago', date: '2000-01-01', time: null }],
      amounts: [],
      actionItems: [],
    }
    const onDetails = vi.fn()
    act(() => root.render(createElement(Reader.SummaryStrip, { topicId: 1, onDetails })))
    await flush()
    const text = host.textContent!
    expect(text).toContain('Gathering in Addis Ababa')
    expect(text).toContain('Needs reply')
    expect(text).toContain('17:00')
    expect(text).not.toContain('2000')
    expect(host.querySelectorAll('.tag')).toHaveLength(3)
    act(() => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Details'))!.click())
    expect(onDetails).toHaveBeenCalled()
  })
})
