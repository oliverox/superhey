import { useState } from 'react'
import type { PostingRow } from '@shared/api'
import { avatarUrl } from '../api'

/**
 * A sender's avatar, as HEY draws it: their logo or photo when they have one, otherwise
 * HEY's colour and initials. The initials show at once and stay if there's no image, so
 * nothing flickers or leaves a gap.
 */
export function Avatar({
  avatar,
  size = 36,
  stacked = false,
  blockedTrackers = false,
}: {
  avatar: PostingRow['avatar']
  size?: number
  /** Several emails bundled into one row. */
  stacked?: boolean
  blockedTrackers?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const letters = avatar.initials.slice(0, 3)
  // HEY fits the letters to the width; scale down as they get more numerous.
  const fontSize = size * (letters.length >= 3 ? 0.3 : letters.length === 2 ? 0.36 : 0.44)
  const face = { width: size, height: size, background: avatar.color ?? 'var(--pane-sunk)' }

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      {stacked && (
        <span className="avatar-shape absolute opacity-45" style={{ ...face, transform: `translate(${size * 0.14}px, ${-size * 0.14}px)` }} />
      )}
      <span
        className="avatar-shape relative flex items-center justify-center overflow-hidden font-extrabold tracking-[-0.03em] text-black/85"
        style={{ ...face, fontSize, fontFamily: 'var(--font-ui)' }}
      >
        {letters}
        {avatar.url && (
          <img
            src={avatarUrl(avatar.url)}
            alt=""
            draggable={false}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className={`absolute inset-0 size-full bg-pane object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
      </span>
      {blockedTrackers && (
        <span
          className="absolute -top-1 -left-1 flex size-[17px] items-center justify-center rounded-full border-2 border-pane bg-accent text-accent-ink"
          title="HEY blocked spy trackers in this email"
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 1 2.5 3v4.3c0 3.4 2.3 6.4 5.5 7.7 3.2-1.3 5.5-4.3 5.5-7.7V3z" />
          </svg>
        </span>
      )}
    </span>
  )
}
