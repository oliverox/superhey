// 16px line icons, shared by the toolbar and the sidebar so each thing is drawn one way.
export const icon = (d: React.ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
)
export const ReplyLaterIcon = () => icon(<><circle cx="8" cy="8" r="5.75" /><path d="M8 5v3l2 1.5" /></>)
export const SetAsideIcon = () => icon(<path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" />)
export const BubbleIcon = () => icon(<><path d="M8 12.5v-8" /><path d="m4.5 7.5 3.5-3.5 3.5 3.5" /><path d="M3.5 14h9" /></>)
export const MoveIcon = () => icon(<><path d="M2.5 5.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /><path d="M2.5 5.5 4 2.5h8l1.5 3" /><path d="M8 7.5v4M6 9.5l2 2 2-2" /></>)
export const LabelIcon = () => icon(<><path d="M2.5 3.5v4l6 6 5-5-6-6h-4a1 1 0 0 0-1 1z" /><circle cx="5.5" cy="5.5" r=".8" fill="currentColor" /></>)
export const TrashIcon = () => icon(<><path d="M3 4.5h10" /><path d="M6 4.5v-2h4v2" /><path d="M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6" /></>)

// The sidebar's places. Reply Later, Set Aside and Bubble Up reuse the toolbar's icons.
export const TodayIcon = () => icon(<><circle cx="8" cy="8" r="2.6" /><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" /></>)
export const ImboxIcon = () => icon(<><path d="M2.5 9.5 4 3.5h8l1.5 6v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /><path d="M2.5 9.5h3l.8 1.5h3.4l.8-1.5h3" /></>)
export const FeedIcon = () => icon(<><path d="M3.5 3.5a9 9 0 0 1 9 9" /><path d="M3.5 7.5a5 5 0 0 1 5 5" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /></>)
export const PaperTrailIcon = () => icon(<><path d="M4 2.5h5.5L12 5v8.5H4z" /><path d="M9.5 2.5V5H12M6 8h4M6 10.5h4" /></>)
export const CalendarIcon = () => icon(<><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>)
