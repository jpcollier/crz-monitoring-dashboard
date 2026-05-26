interface ChangeBadgeProps {
  /** Percentage change value. Positive = increase, negative = decrease. */
  pctChange: number | null
  /** Optional tooltip text shown on hover. */
  tooltip?: string
  className?: string
}

/**
 * Shows a % change badge. Color direction: decrease = green, increase = red.
 * This reflects the CRZ program goal — fewer vehicle entries is a success.
 */
export default function ChangeBadge({ pctChange, tooltip, className = '' }: ChangeBadgeProps) {
  if (pctChange === null) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 ${className}`}
        title={tooltip}
      >
        —
      </span>
    )
  }

  const isDecrease = pctChange < 0
  const isZero = pctChange === 0

  const colorClass = isZero
    ? 'bg-gray-100 text-gray-600'
    : isDecrease
      ? 'bg-green-50 text-green-700'
      : 'bg-red-50 text-red-700'

  const arrow = isZero ? null : isDecrease ? '↓' : '↑'
  const sign = pctChange > 0 ? '+' : ''
  const label = `${sign}${pctChange.toFixed(1)}%`

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium tabular-nums ${colorClass} ${className}`}
      title={tooltip ?? label}
    >
      {arrow && <span aria-hidden>{arrow}</span>}
      {label}
    </span>
  )
}
