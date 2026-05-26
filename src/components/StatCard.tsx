// ---------------------------------------------------------------------------
// StatCard — a single KPI tile for the summary stat row
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string
  value: React.ReactNode
  isLoading?: boolean
}

export default function StatCard({ label, value, isLoading = false }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 leading-none mb-2.5">
        {label}
      </p>
      {isLoading ? (
        <div className="h-8 w-24 bg-gray-100 rounded animate-pulse mt-1" />
      ) : (
        <p className="text-2xl font-bold text-gray-900 leading-tight tabular-nums">
          {value}
        </p>
      )}
    </div>
  )
}
