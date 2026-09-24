// HEY's own avatar colours (the most used in a real cache). Dark initials read on all of
// them, in light and dark themes.
const HEY_PALETTE = ['#FF7182', '#7CE9FB', '#F95C5C', '#CFF523', '#F87917', '#7ED321', '#E57CFB', '#FF84C5', '#BCFF94', '#23B7F5', '#06D004', '#FFCC00', '#50E3C2', '#C54AFF']

/** A colour for senders HEY gave none: stable per seed, so a sender always looks the same. */
export function paletteColor(seed: string): string {
  let h = 0
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return HEY_PALETTE[h % HEY_PALETTE.length]!
}
