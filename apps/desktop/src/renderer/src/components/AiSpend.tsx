import { api, useLive } from '../api'
import { AiSparkle } from './DraftReply'

const usd = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`)

/**
 * What the AI has cost this month, next to the search box: a sparkle and the sum, with a
 * ring that fills towards the budget (amber near it, red once it's reached). Opens
 * Settings → Usage. Hidden until AI is set up.
 */
export function AiSpend({ onOpen }: { onOpen: () => void }) {
  const status = useLive(() => api.aiStatus(), [], (e) => e.type === 'ai').data
  if (!status || (!status.mode.cloud && !status.mode.local && status.month.spentUsd === 0)) return null
  const { spentUsd, budgetUsd, calls } = status.month
  const share = budgetUsd ? Math.min(1, spentUsd / budgetUsd) : null
  // Red only once 80% of the budget is spent; quiet ink until then.
  const tone = share != null && share >= 0.8 ? 'var(--danger)' : 'var(--ink-faint)'
  const title = `AI this month: ${usd(spentUsd)}${budgetUsd ? ` of your ${usd(budgetUsd)} budget` : ''} · ${calls.toLocaleString()} ${calls === 1 ? 'request' : 'requests'}. Open usage`
  const r = 5.5
  const c = 2 * Math.PI * r
  return (
    <button
      onClick={onOpen}
      title={title}
      aria-label={title}
      className={`no-drag ml-2 flex h-7 shrink-0 items-center gap-1.5 rounded-ui px-2 text-[12px] font-medium tabular-nums hover:bg-pane-sunk ${share != null && share >= 0.8 ? 'text-danger' : 'text-ink-soft hover:text-ink'}`}
    >
      {share == null ? (
        <AiSparkle size={12} />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0 -rotate-90">
          <circle cx="7" cy="7" r={r} fill="none" stroke="var(--rule-strong)" strokeWidth="2" />
          <circle cx="7" cy="7" r={r} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${Math.max(share * c, share > 0 ? 1.5 : 0)} ${c}`} />
        </svg>
      )}
      {usd(spentUsd)}
    </button>
  )
}
