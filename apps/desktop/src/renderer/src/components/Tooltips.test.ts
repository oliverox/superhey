import { describe, expect, it } from 'vitest'
import { withShortcut } from '../shortcuts'
import { splitShortcut } from './Tooltips'

describe('splitShortcut', () => {
  it('draws the key of a withShortcut label as a key', () => {
    expect(splitShortcut(withShortcut('Reply Later', 'replyLater'))).toEqual({ text: 'Reply Later', key: 'r' })
    expect(splitShortcut('Reply all (⇧R)')).toEqual({ text: 'Reply all', key: '⇧R' })
  })

  it('leaves ordinary parentheses in the text', () => {
    expect(splitShortcut('Open in HEY (opens your browser)')).toEqual({ text: 'Open in HEY (opens your browser)', key: null })
    expect(splitShortcut('Move to Trash')).toEqual({ text: 'Move to Trash', key: null })
  })
})
