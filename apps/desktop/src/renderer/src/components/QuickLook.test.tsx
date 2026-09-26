// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentRow } from '@shared/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const calls: Array<[string, unknown[]]> = []
let QL: typeof import('./QuickLook')
let People: typeof import('./People')
beforeAll(async () => {
  window.bridge = { call: async (m, a) => (calls.push([m, a]), null), onEvent: () => () => {} }
  QL = await import('./QuickLook')
  People = await import('./People')
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  calls.length = 0
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const file = (id: string, filename: string, contentType: string) => ({ id, filename, contentType, byteSize: 1000, embedded: false }) as AttachmentRow
const photos = [file('1:1', 'harbour.jpg', 'image/jpeg'), file('1:2', 'map.png', 'image/png')]
const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

describe('Quick Look', () => {
  it('previews PDFs and images only', () => {
    expect(QL.canPreview(file('a', 'report.pdf', 'application/pdf'))).toBe(true)
    expect(QL.canPreview(file('b', 'scan.PDF', 'application/octet-stream'))).toBe(true)
    expect(QL.canPreview(photos[0]!)).toBe(true)
    expect(QL.canPreview(file('c', 'budget.xlsx', 'application/vnd.ms-excel'))).toBe(false)
  })

  it('moves through the files with the arrows and closes with Space or Esc', () => {
    const onIndex = vi.fn()
    const onClose = vi.fn()
    act(() => root.render(createElement(QL.QuickLook, { files: photos, index: 0, onIndex, onClose })))
    expect(document.body.textContent).toContain('harbour.jpg')
    expect(document.body.textContent).toContain('1 of 2')
    key('ArrowRight')
    expect(onIndex).toHaveBeenLastCalledWith(1)
    key('ArrowLeft')
    expect(onIndex).toHaveBeenLastCalledWith(1) // wraps round from the first
    key(' ')
    key('Escape')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('hands the file to its own app on request', () => {
    act(() => root.render(createElement(QL.QuickLook, { files: photos, index: 1, onIndex: vi.fn(), onClose: vi.fn() })))
    act(() => [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Open in app')!.click())
    expect(calls).toContainEqual(['openAttachment', ['1:2']])
  })
})

describe('recipient summary in tight space', () => {
  it('steps down to a shorter form until it fits', () => {
    // jsdom has no layout: the box reports overflow until the text is short enough.
    const widths = new Map([['to you, Dana and 3 others', 190], ['to you and 4 others', 140], ['to you +4', 70]])
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return widths.get(this.textContent ?? '') ?? 0
    })
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
    act(() => root.render(createElement('div', null, createElement('div', null, createElement('button', null, createElement(People.FitText, { variants: [...widths.keys()] }))))))
    expect(host.textContent).toBe('to you +4')
    expect(host.querySelector('span')!.title).toBe('to you, Dana and 3 others')
    scroll.mockRestore()
    client.mockRestore()
  })
})

describe('zoom', () => {
  it('steps through the zoom levels and stops at the ends', () => {
    expect(QL.nextZoom(1, 1)).toBe(1.25)
    expect(QL.nextZoom(1, -1)).toBe(0.8)
    expect(QL.nextZoom(1.1, 1)).toBe(1.25) // from a pinched level to the next step
    expect(QL.nextZoom(1.1, -1)).toBe(1)
    expect(QL.nextZoom(3, 1)).toBe(3)
    expect(QL.nextZoom(0.5, -1)).toBe(0.5)
  })
})
