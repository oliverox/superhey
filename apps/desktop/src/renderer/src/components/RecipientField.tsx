import { useState } from 'react'
import { parseAddresses } from '../mail/forwarded'

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/

export const isEmail = (s: string) => EMAIL.test(s.trim())

/**
 * Addresses as chips. Enter, comma, semicolon or Tab turns what's typed into a chip;
 * Backspace on an empty field removes the last one; pasting "Name <a@b.c>, d@e.f" works.
 * Anything that isn't an address shows in red (and blocks sending).
 */
export function RecipientField({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string
  value: string[]
  onChange: (v: string[]) => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')

  const commit = (raw: string) => {
    const found = parseAddresses(raw).map((a) => a.email)
    const extra = found.length ? found : raw.split(/[,;\s]+/).filter(Boolean)
    if (!extra.length) return
    const seen = new Set(value.map((v) => v.toLowerCase()))
    onChange([...value, ...extra.filter((e) => !seen.has(e.toLowerCase()))])
    setText('')
  }

  return (
    <label className="flex min-h-9 flex-wrap items-center gap-1.5 border-b border-rule px-4 py-1.5 text-[13px]">
      <span className="w-12 shrink-0 text-ink-faint">{label}</span>
      {value.map((addr, i) => (
        <span
          key={addr}
          className={`inline-flex items-center gap-1 rounded-ui py-0.5 pr-1 pl-2 text-[12.5px] ${
            isEmail(addr) ? 'bg-pane-sunk text-ink' : 'bg-danger/15 text-danger'
          }`}
          title={isEmail(addr) ? addr : `Not an email address: ${addr}`}
        >
          {addr}
          <button
            type="button"
            aria-label={`Remove ${addr}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="rounded px-0.5 text-ink-faint hover:text-ink"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => {
          const v = e.target.value
          if (/[,;]\s*$/.test(v)) commit(v.replace(/[,;]\s*$/, ''))
          else setText(v)
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) {
            e.preventDefault()
            commit(text)
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => text.trim() && commit(text)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (/[,;\n]|@.*@/.test(pasted)) {
            e.preventDefault()
            commit(pasted)
          }
        }}
        aria-label={`${label} recipients`}
        className="min-w-[160px] flex-1 bg-transparent py-0.5 text-ink outline-none"
      />
    </label>
  )
}
