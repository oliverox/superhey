import type { ReactNode } from 'react'
import { setLook, showsDark, useLook, type Scheme } from '../theme'
import { DEFAULT_THEMES, OMARCHY_THEMES, type Colors } from '../themes'
import { OmarchyLogo } from './OmarchyLogo'

/**
 * The theme manager (Settings → Appearance): the style, light or dark for Default, and the
 * colour theme, each shown as a small picture of the app in its colours. Changes apply at
 * once. Default themes show both their light and dark sides; Omarchy's are one palette each.
 */
export function Appearance({ Section }: { Section: (p: { title: string; hint: string; children: ReactNode }) => ReactNode }) {
  const look = useLook()
  const omarchy = look.theme === 'omarchy'
  const dark = showsDark(look.scheme)

  return (
    <>
      <Section title="Style" hint="Default is SuperHey’s own look. Omarchy is squared-off and monospaced, in the colours of Omarchy’s themes.">
        <div role="radiogroup" aria-label="Style" className="grid grid-cols-2 gap-3">
          <StyleCard on={!omarchy} onClick={() => setLook({ theme: 'default' })} label="Default">
            <Split theme={DEFAULT_THEMES.find((t) => t.id === look.palette) ?? DEFAULT_THEMES[0]!} />
          </StyleCard>
          <StyleCard on={omarchy} onClick={() => setLook({ theme: 'omarchy' })} label="Omarchy" icon={<OmarchyLogo className="size-[13px]" />}>
            <Mini c={(OMARCHY_THEMES.find((t) => t.id === look.omarchy) ?? OMARCHY_THEMES[0]!).colors} square />
          </StyleCard>
        </div>
      </Section>

      {!omarchy && (
        <Section title="Mode" hint="Every Default theme comes in light and dark. System follows your Mac.">
          <div role="radiogroup" aria-label="Mode" className="inline-flex rounded-ui bg-pane-sunk p-0.5">
            {(['light', 'dark', 'auto'] as Scheme[]).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={look.scheme === s}
                onClick={() => setLook({ scheme: s })}
                className={`rounded-ui px-4 py-1 text-[13px] font-medium transition-colors ${look.scheme === s ? 'bg-pane text-ink shadow-sm' : 'text-ink-faint hover:text-ink-soft'}`}
              >
                {s === 'auto' ? 'System' : s === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Theme"
        hint={omarchy ? 'Omarchy’s own themes, as in Omarchy.' : `Each shows its light and dark side; the ${dark ? 'dark' : 'light'} one is showing now.`}
      >
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
          {omarchy
            ? OMARCHY_THEMES.map((t) => (
                <ThemeCard key={t.id} on={look.omarchy === t.id} onClick={() => setLook({ omarchy: t.id })} name={t.name} note={t.scheme === 'light' ? 'Light' : undefined} mono>
                  <Mini c={t.colors} square />
                </ThemeCard>
              ))
            : DEFAULT_THEMES.map((t) => (
                <ThemeCard key={t.id} on={look.palette === t.id} onClick={() => setLook({ palette: t.id })} name={t.name} note={t.blurb}>
                  <Split theme={t} showing={dark ? 'dark' : 'light'} />
                </ThemeCard>
              ))}
        </div>
      </Section>
    </>
  )
}

function StyleCard({ on, onClick, label, icon, children }: { on: boolean; onClick: () => void; label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`group rounded-ui-lg border p-2 text-left transition-[border-color,box-shadow] ${on ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-rule hover:border-rule-strong'}`}
    >
      {children}
      <span className="mt-2 flex items-center gap-1.5 px-0.5 text-[13px] font-medium text-ink">
        {icon}
        {label}
        {on && <Check />}
      </span>
    </button>
  )
}

function ThemeCard({ on, onClick, name, note, mono, children }: { on: boolean; onClick: () => void; name: string; note?: string; mono?: boolean; children: ReactNode }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      aria-label={name}
      onClick={onClick}
      className={`rounded-ui-lg border p-1.5 text-left transition-[border-color,box-shadow] ${on ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-rule hover:border-rule-strong'}`}
    >
      {children}
      <span className="mt-1.5 flex items-baseline gap-1.5 px-0.5">
        <span className={`truncate text-[13px] font-medium text-ink ${mono ? 'font-mono' : ''}`}>{name}</span>
        {on && <Check />}
      </span>
      {note && <span className="block truncate px-0.5 pb-0.5 text-[11px] text-ink-faint">{note}</span>}
    </button>
  )
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="ml-auto shrink-0 self-center text-accent">
      <path d="m3 8.5 3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A Default theme's light and dark sides, side by side on a diagonal; `showing` is the one in use now. */
function Split({ theme, showing }: { theme: (typeof DEFAULT_THEMES)[number]; showing?: 'light' | 'dark' }) {
  return (
    <div className="relative overflow-hidden rounded-[7px]">
      <Mini c={theme.light} dim={showing === 'dark'} />
      <div className="absolute inset-0 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]">
        <Mini c={theme.dark} dim={showing === 'light'} />
      </div>
    </div>
  )
}

/** A thumbnail of the app in `c`: sidebar, a list with one row selected, an unread dot. */
function Mini({ c, square, dim }: { c: Colors; square?: boolean; dim?: boolean }) {
  return (
    <div
      aria-hidden
      className={`flex h-[72px] w-full overflow-hidden ${square ? '' : 'rounded-[7px]'} ${dim ? 'saturate-[0.85]' : ''}`}
      style={{ background: c.bg, boxShadow: `inset 0 0 0 1px ${c.ruleStrong}` }}
    >
      <div className="flex w-[24%] flex-col gap-[5px] px-[7px] pt-[9px]" style={{ background: c.side }}>
        <span className="h-[5px] w-[80%]" style={{ background: c.sideSel, borderRadius: square ? 0 : 2 }} />
        <span className="h-[3px] w-[64%]" style={{ background: c.sideSoft, opacity: 0.7, borderRadius: 2 }} />
        <span className="h-[3px] w-[52%]" style={{ background: c.sideFaint, borderRadius: 2 }} />
        <span className="h-[3px] w-[70%]" style={{ background: c.sideFaint, borderRadius: 2 }} />
      </div>
      <div className="flex flex-1 flex-col gap-[6px] px-[8px] pt-[9px]" style={{ background: c.pane }}>
        <div className="flex items-center gap-[5px] px-[4px] py-[4px]" style={{ background: `color-mix(in oklab, ${c.accent} 16%, ${c.pane})`, borderRadius: square ? 0 : 3 }}>
          <span className="size-[5px] shrink-0 rounded-full" style={{ background: c.accent }} />
          <span className="h-[4px] w-[58%]" style={{ background: c.ink, borderRadius: 2 }} />
        </div>
        <div className="flex items-center gap-[5px] px-[4px]">
          <span className="size-[5px] shrink-0" />
          <span className="h-[3px] w-[70%]" style={{ background: c.inkSoft, borderRadius: 2 }} />
        </div>
        <div className="flex items-center gap-[5px] px-[4px]">
          <span className="size-[5px] shrink-0" />
          <span className="h-[3px] w-[46%]" style={{ background: c.inkFaint, borderRadius: 2 }} />
          <span className="ml-auto h-[7px] w-[16px]" style={{ background: c.accent, borderRadius: square ? 0 : 2 }} />
        </div>
      </div>
    </div>
  )
}
