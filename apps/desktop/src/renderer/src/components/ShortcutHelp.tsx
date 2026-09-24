import { useEffect } from 'react'
import { keyLabel, SHORTCUTS, type ShortcutDef } from '../shortcuts'

const GROUPS: Array<ShortcutDef['group']> = ['Navigate', 'Thread', 'Act', 'App']

/** Every shortcut, generated from the same table the keys run from. `?` or Esc closes it. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const defs = Object.values(SHORTCUTS) as ShortcutDef[]
  // The six box keys read better as one line.
  const rows = (group: ShortcutDef['group']) =>
    group === 'Navigate'
      ? [...defs.filter((d) => d.group === group && !/^\d$/.test(d.keys[0]!)), { keys: ['1', '6'], label: 'Go to box', group, range: true }]
      : defs.filter((d) => d.group === group)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/25 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Keyboard shortcuts" className="rise w-full max-w-[720px] rounded-ui-lg border border-rule-strong bg-pane p-6 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)]">
        <header className="mb-4 flex items-baseline">
          <h2 className="text-[15px] font-semibold">Keyboard shortcuts</h2>
          <span className="ml-auto text-[12px] text-ink-faint">
            <Kbd k="?" /> or <Kbd k="Esc" /> to close
          </span>
        </header>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3 className="eyebrow mb-1.5">{g}</h3>
              <dl>
                {rows(g).map((d) => (
                  <div key={d.label} className="flex items-center justify-between gap-3 py-[3px] text-[13px]">
                    <dt className="text-ink-soft">{d.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                      {'range' in d ? (
                        <>
                          <Kbd k="1" />–<Kbd k="6" />
                        </>
                      ) : (
                        d.keys.map((k, i) => (
                          <span key={k} className="flex items-center gap-1">
                            {i > 0 && 'or'}
                            <Kbd k={keyLabel(k)} />
                          </span>
                        ))
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function Kbd({ k }: { k: string }) {
  return <kbd className="min-w-[20px] text-center text-[11px] text-ink-soft">{k}</kbd>
}
