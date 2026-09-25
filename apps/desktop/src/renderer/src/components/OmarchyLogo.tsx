// Omarchy's square mark: glyph U+E900 of its icon font (github.com/basecamp/omarchy,
// default/fonts/omarchy/omarchy.ttf, MIT), as a path. Drawn in the current text colour.
export function OmarchyLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 -1024 1024 1024" fill="currentColor" aria-hidden className={className}>
      <path
        transform="scale(1,-1)"
        d="M70 70H549V0H0V1024H1024V0H626V70H954V954H70ZM884 140H140V884H551V814H210V210H814V814H736V884H884ZM471 140H549V70H471ZM473 954H551V884H473ZM0 551H210V473H0Z"
      />
    </svg>
  )
}
