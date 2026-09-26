/**
 * Colour themes. The Default style's themes each come in light and dark (the Light / Dark /
 * System choice picks which shows); the Omarchy style has Omarchy's own themes, one palette
 * each (most dark, a few light). Graphite and Tokyo Night are the styles' own colours in
 * styles.css; the rest are written into a <style> as overrides of the same tokens.
 */

/** The colours a Default theme sets, for one of its modes. */
export interface Colors {
  bg: string
  side: string
  sideInk: string
  sideSoft: string
  sideFaint: string
  sideSel: string
  pane: string
  paneAlt: string
  paneSunk: string
  ink: string
  inkSoft: string
  inkFaint: string
  rule: string
  ruleStrong: string
  accent: string
  accentInk: string
}

export interface DefaultTheme {
  id: string
  name: string
  blurb: string
  light: Colors
  dark: Colors
}

/** An Omarchy theme: its palette, plus the status colours it uses. */
export interface OmarchyTheme {
  id: string
  name: string
  scheme: 'light' | 'dark'
  colors: Colors & { newDot: string; danger: string; ok: string; attn: string }
}

const graphiteLight: Colors = {
  bg: '#e9ebef', side: '#17191e', sideInk: '#f1f2f5', sideSoft: '#a6abb6', sideFaint: '#6b717d', sideSel: '#262a31',
  pane: '#ffffff', paneAlt: '#f7f8fa', paneSunk: '#eef0f3', ink: '#101217', inkSoft: '#4a505c', inkFaint: '#676d79',
  rule: '#dfe2e7', ruleStrong: '#d3d6dc', accent: '#3355ff', accentInk: '#ffffff',
}
const graphiteDark: Colors = {
  bg: '#0b0c0f', side: '#0f1013', sideInk: '#f1f2f5', sideSoft: '#a6abb6', sideFaint: '#6b717d', sideSel: '#1d2026',
  pane: '#14161a', paneAlt: '#181a1f', paneSunk: '#1d2026', ink: '#eceef2', inkSoft: '#a7adb8', inkFaint: '#818794',
  rule: '#23262d', ruleStrong: '#2f333b', accent: '#7b91ff', accentInk: '#0b0c0f',
}

export const DEFAULT_THEMES: DefaultTheme[] = [
  { id: 'graphite', name: 'Graphite', blurb: 'Cool greys, cobalt', light: graphiteLight, dark: graphiteDark },
  {
    id: 'linen',
    name: 'Linen',
    blurb: 'Warm paper, terracotta',
    light: {
      bg: '#ebe7e0', side: '#221e1a', sideInk: '#f3efe9', sideSoft: '#b3aa9e', sideFaint: '#7d7468', sideSel: '#332d27',
      pane: '#fffdf9', paneAlt: '#faf7f2', paneSunk: '#f2eee7', ink: '#1d1a16', inkSoft: '#57504a', inkFaint: '#736b62',
      rule: '#e6e0d7', ruleStrong: '#d9d2c7', accent: '#bb5128', accentInk: '#ffffff',
    },
    dark: {
      bg: '#0f0d0b', side: '#131110', sideInk: '#f3efe9', sideSoft: '#b3aa9e', sideFaint: '#7d7468', sideSel: '#25211d',
      pane: '#1a1714', paneAlt: '#1e1b17', paneSunk: '#25211d', ink: '#efe9e1', inkSoft: '#b5ab9f', inkFaint: '#91877b',
      rule: '#2b2621', ruleStrong: '#38322b', accent: '#e8895a', accentInk: '#140f0b',
    },
  },
  {
    id: 'fjord',
    name: 'Fjord',
    blurb: 'Slate blue, sea teal',
    light: {
      bg: '#e5eaed', side: '#12222a', sideInk: '#eef4f6', sideSoft: '#9fb3bc', sideFaint: '#667b85', sideSel: '#1f343e',
      pane: '#ffffff', paneAlt: '#f5f8f9', paneSunk: '#ebf0f2', ink: '#0f1a1f', inkSoft: '#45555d', inkFaint: '#5f6f77',
      rule: '#dbe3e7', ruleStrong: '#cdd7dc', accent: '#0b7580', accentInk: '#ffffff',
    },
    dark: {
      bg: '#080e11', side: '#0b1418', sideInk: '#eef4f6', sideSoft: '#9fb3bc', sideFaint: '#667b85', sideSel: '#17252c',
      pane: '#10191d', paneAlt: '#131e23', paneSunk: '#17252c', ink: '#e6eef1', inkSoft: '#a0b2b9', inkFaint: '#7c8f97',
      rule: '#1c2a31', ruleStrong: '#27373f', accent: '#45c4cf', accentInk: '#061013',
    },
  },
  {
    id: 'moss',
    name: 'Moss',
    blurb: 'Sage and forest green',
    light: {
      bg: '#e7eae3', side: '#18201a', sideInk: '#eef2ea', sideSoft: '#a7b3a2', sideFaint: '#6f7b6a', sideSel: '#263027',
      pane: '#ffffff', paneAlt: '#f7f8f4', paneSunk: '#eef0ea', ink: '#141a12', inkSoft: '#4b5546', inkFaint: '#656f60',
      rule: '#dde2d7', ruleStrong: '#d0d6c9', accent: '#3a7536', accentInk: '#ffffff',
    },
    dark: {
      bg: '#0a0d09', side: '#0d110c', sideInk: '#eef2ea', sideSoft: '#a7b3a2', sideFaint: '#6f7b6a', sideSel: '#1b2219',
      pane: '#121611', paneAlt: '#151a14', paneSunk: '#1b2219', ink: '#e8ede4', inkSoft: '#a9b3a4', inkFaint: '#858f80',
      rule: '#212920', ruleStrong: '#2d362b', accent: '#86c07a', accentInk: '#0a1008',
    },
  },
  {
    id: 'plum',
    name: 'Plum',
    blurb: 'Dusky mauve, orchid',
    light: {
      bg: '#eae6ed', side: '#1d1622', sideInk: '#f3eff5', sideSoft: '#b0a6b7', sideFaint: '#7a7082', sideSel: '#2d2433',
      pane: '#ffffff', paneAlt: '#f8f6f9', paneSunk: '#efebf1', ink: '#18121c', inkSoft: '#524a58', inkFaint: '#6c6373',
      rule: '#e2dce6', ruleStrong: '#d5cedb', accent: '#853b9b', accentInk: '#ffffff',
    },
    dark: {
      bg: '#0d0a0f', side: '#110d13', sideInk: '#f3eff5', sideSoft: '#b0a6b7', sideFaint: '#7a7082', sideSel: '#221b27',
      pane: '#17131a', paneAlt: '#1b161e', paneSunk: '#221b27', ink: '#efe9f2', inkSoft: '#b3a9ba', inkFaint: '#908697',
      rule: '#282030', ruleStrong: '#352b3c', accent: '#c792e0', accentInk: '#120c15',
    },
  },
]

type O = OmarchyTheme['colors']
const o = (c: Omit<O, 'sideInk' | 'sideSoft' | 'sideFaint'> & Partial<Pick<O, 'sideInk' | 'sideSoft' | 'sideFaint'>>): O => ({
  ...c,
  sideInk: c.sideInk ?? c.ink,
  sideSoft: c.sideSoft ?? c.inkSoft,
  sideFaint: c.sideFaint ?? c.inkFaint,
})

export const OMARCHY_THEMES: OmarchyTheme[] = [
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    scheme: 'dark',
    colors: o({
      bg: '#1a1b26', side: '#16161e', sideSoft: '#a9b1d6', sideFaint: '#565f89', sideSel: '#283457', pane: '#16161e', paneAlt: '#1a1b26', paneSunk: '#1f2335',
      ink: '#c0caf5', inkSoft: '#a9b1d6', inkFaint: '#8089b3', rule: '#292e42', ruleStrong: '#414868', accent: '#7aa2f7', accentInk: '#16161e',
      newDot: '#ff9e64', danger: '#f7768e', ok: '#9ece6a', attn: '#e0af68',
    }),
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    scheme: 'dark',
    colors: o({
      bg: '#1e1e2e', side: '#181825', sideSel: '#313244', pane: '#181825', paneAlt: '#1e1e2e', paneSunk: '#313244',
      ink: '#cdd6f4', inkSoft: '#bac2de', inkFaint: '#9399b2', rule: '#313244', ruleStrong: '#45475a', accent: '#89b4fa', accentInk: '#11111b',
      newDot: '#fab387', danger: '#f38ba8', ok: '#a6e3a1', attn: '#f9e2af',
    }),
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    scheme: 'light',
    colors: o({
      bg: '#e6e9ef', side: '#dce0e8', sideSel: '#ccd0da', pane: '#eff1f5', paneAlt: '#e6e9ef', paneSunk: '#dce0e8',
      ink: '#4c4f69', inkSoft: '#5c5f77', inkFaint: '#6c6f85', rule: '#ccd0da', ruleStrong: '#bcc0cc', accent: '#1e66f5', accentInk: '#eff1f5',
      newDot: '#fe640b', danger: '#d20f39', ok: '#40a02b', attn: '#b16a0a',
    }),
  },
  {
    id: 'everforest',
    name: 'Everforest',
    scheme: 'dark',
    colors: o({
      bg: '#2d353b', side: '#232a2e', sideSel: '#3d484d', pane: '#232a2e', paneAlt: '#2d353b', paneSunk: '#343f44',
      ink: '#d3c6aa', inkSoft: '#9da9a0', inkFaint: '#8e9a91', rule: '#343f44', ruleStrong: '#475258', accent: '#a7c080', accentInk: '#232a2e',
      newDot: '#e69875', danger: '#e67e80', ok: '#83c092', attn: '#dbbc7f',
    }),
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    scheme: 'dark',
    colors: o({
      bg: '#282828', side: '#1d2021', sideSel: '#3c3836', pane: '#1d2021', paneAlt: '#282828', paneSunk: '#3c3836',
      ink: '#ebdbb2', inkSoft: '#d5c4a1', inkFaint: '#a89984', rule: '#3c3836', ruleStrong: '#504945', accent: '#fabd2f', accentInk: '#1d2021',
      newDot: '#fe8019', danger: '#fb4934', ok: '#b8bb26', attn: '#fabd2f',
    }),
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa',
    scheme: 'dark',
    colors: o({
      bg: '#1f1f28', side: '#16161d', sideSel: '#2d4f67', pane: '#16161d', paneAlt: '#1f1f28', paneSunk: '#2a2a37',
      ink: '#dcd7ba', inkSoft: '#c8c093', inkFaint: '#8f8d82', rule: '#2a2a37', ruleStrong: '#54546d', accent: '#7e9cd8', accentInk: '#16161d',
      newDot: '#ffa066', danger: '#ff5d62', ok: '#98bb6c', attn: '#e6c384',
    }),
  },
  {
    id: 'nord',
    name: 'Nord',
    scheme: 'dark',
    colors: o({
      bg: '#2e3440', side: '#272c36', sideSel: '#434c5e', pane: '#2e3440', paneAlt: '#323946', paneSunk: '#3b4252',
      ink: '#eceff4', inkSoft: '#d8dee9', inkFaint: '#a3abb9', rule: '#3b4252', ruleStrong: '#4c566a', accent: '#88c0d0', accentInk: '#2e3440',
      newDot: '#d08770', danger: '#bf616a', ok: '#a3be8c', attn: '#ebcb8b',
    }),
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    scheme: 'light',
    colors: o({
      bg: '#f2e9e1', side: '#f4ede8', sideSel: '#dfdad9', pane: '#fffaf3', paneAlt: '#faf4ed', paneSunk: '#f2e9e1',
      ink: '#575279', inkSoft: '#6e6a86', inkFaint: '#797593', rule: '#dfdad9', ruleStrong: '#cecacd', accent: '#286983', accentInk: '#fffaf3',
      newDot: '#d7827e', danger: '#b4637a', ok: '#286983', attn: '#b0701a',
    }),
  },
  {
    id: 'flexoki-light',
    name: 'Flexoki Light',
    scheme: 'light',
    colors: o({
      bg: '#f2f0e5', side: '#e6e4d9', sideSel: '#dad8ce', pane: '#fffcf0', paneAlt: '#f2f0e5', paneSunk: '#e6e4d9',
      ink: '#100f0f', inkSoft: '#403e3c', inkFaint: '#6f6e69', rule: '#e6e4d9', ruleStrong: '#cecdc3', accent: '#205ea6', accentInk: '#fffcf0',
      newDot: '#bc5215', danger: '#af3029', ok: '#66800b', attn: '#ad8301',
    }),
  },
  {
    id: 'matte-black',
    name: 'Matte Black',
    scheme: 'dark',
    colors: o({
      bg: '#121212', side: '#0c0c0c', sideSel: '#262626', pane: '#0c0c0c', paneAlt: '#121212', paneSunk: '#1c1c1c',
      ink: '#bebebe', inkSoft: '#9e9e9e', inkFaint: '#8a8a8a', rule: '#222222', ruleStrong: '#333333', accent: '#e68e0d', accentInk: '#0c0c0c',
      newDot: '#e68e0d', danger: '#d35f5f', ok: '#8ea56b', attn: '#e0a84e',
    }),
  },
  {
    id: 'ristretto',
    name: 'Ristretto',
    scheme: 'dark',
    colors: o({
      bg: '#2c2525', side: '#211c1c', sideSel: '#403838', pane: '#211c1c', paneAlt: '#2c2525', paneSunk: '#383030',
      ink: '#fff1f3', inkSoft: '#d9cbcd', inkFaint: '#a8999b', rule: '#383030', ruleStrong: '#5b5353', accent: '#f9cc6c', accentInk: '#211c1c',
      newDot: '#f38d70', danger: '#fd6883', ok: '#adda78', attn: '#f9cc6c',
    }),
  },
]

const vars = (c: Colors, dark: boolean) =>
  [
    `--bg:${c.bg}`,
    `--side-bg:${c.side}`,
    `--side-ink:${c.sideInk}`,
    `--side-soft:${c.sideSoft}`,
    `--side-faint:${c.sideFaint}`,
    `--side-sel:${c.sideSel}`,
    `--side-rule:${c.sideSel}`,
    `--pane:${c.pane}`,
    `--pane-alt:${c.paneAlt}`,
    `--pane-sunk:${c.paneSunk}`,
    `--ink:${c.ink}`,
    `--ink-soft:${c.inkSoft}`,
    `--ink-faint:${c.inkFaint}`,
    `--rule:${c.rule}`,
    `--rule-strong:${c.ruleStrong}`,
    `--accent:${c.accent}`,
    `--accent-ink:${c.accentInk}`,
    `--accent-wash:color-mix(in oklab, ${c.accent} ${dark ? 20 : 11}%, ${c.pane})`,
    `--selection:color-mix(in oklab, ${c.accent} ${dark ? 20 : 11}%, ${c.pane})`,
    `--new:${c.accent}`,
  ].join(';')

/** The CSS for every theme but the styles' own (Graphite, Tokyo Night). */
export function themeCss(): string {
  const out: string[] = []
  for (const t of DEFAULT_THEMES.slice(1)) {
    const on = `:root[data-palette='${t.id}']:not([data-theme='omarchy'])`
    out.push(`${on}{${vars(t.light, false)}}`)
    out.push(`@media (prefers-color-scheme: dark){${on}:not([data-scheme='light']){${vars(t.dark, true)};color-scheme:dark}}`)
    out.push(`:root[data-palette='${t.id}'][data-scheme='dark']:not([data-theme='omarchy']){${vars(t.dark, true)};color-scheme:dark}`)
  }
  for (const t of OMARCHY_THEMES.slice(1)) {
    const c = t.colors
    const dark = t.scheme === 'dark'
    out.push(
      `:root[data-theme='omarchy'][data-omarchy='${t.id}']{${vars(c, dark)};--new:${c.newDot};--danger:${c.danger};--ok:${c.ok};--attn:${c.attn};` +
        `--attn-wash:color-mix(in oklab, ${c.attn} 16%, ${c.pane});--tip-bg:${c.paneSunk};--tip-ink:${c.ink};--tip-rule:${c.ruleStrong};--tip-key-rule:${c.ruleStrong};color-scheme:${t.scheme}}`,
    )
  }
  return out.join('\n')
}

/** Writes the themes' CSS into the page once. */
export function installThemes() {
  if (typeof document === 'undefined' || document.getElementById('superhey-themes')) return
  const style = document.createElement('style')
  style.id = 'superhey-themes'
  style.textContent = themeCss()
  document.head.append(style)
}

export const defaultTheme = (id: string) => DEFAULT_THEMES.find((t) => t.id === id) ?? DEFAULT_THEMES[0]!
export const omarchyTheme = (id: string) => OMARCHY_THEMES.find((t) => t.id === id) ?? OMARCHY_THEMES[0]!
