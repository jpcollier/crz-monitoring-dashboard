interface ChangeBadgeProps {
  pctChange: number | null
  tooltip?: string
  className?: string
}

/**
 * Shows a % change badge. Color direction: decrease = indigo (good for CRZ
 * goal of fewer vehicle entries), increase = signal red (bad).
 */
export default function ChangeBadge({ pctChange, tooltip, className = '' }: ChangeBadgeProps) {
  if (pctChange === null) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-semibold border border-ink-300 text-ink-500 ${className}`}
        style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}
        title={tooltip}
      >
        —
      </span>
    )
  }

  const isDecrease = pctChange < 0
  const isZero = pctChange === 0

  const style = isZero
    ? { background: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--rule-soft)' }
    : isDecrease
      ? { background: '#0E2A47', color: '#FBF6EA', border: '1px solid #0E2A47' }
      : { background: '#C8102E', color: '#FBF6EA', border: '1px solid #C8102E' }

  const arrow = isZero ? null : isDecrease ? '↓' : '↑'
  const sign = pctChange > 0 ? '+' : ''
  const label = `${sign}${pctChange.toFixed(1)}%`

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-semibold tabular ${className}`}
      style={{ ...style, fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}
      title={tooltip ?? label}
    >
      {arrow && <span aria-hidden>{arrow}</span>}
      {label}
    </span>
  )
}
