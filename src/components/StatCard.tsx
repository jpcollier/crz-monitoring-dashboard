interface StatCardProps {
  label: string
  value: React.ReactNode
  isLoading?: boolean
}

export default function StatCard({ label, value, isLoading = false }: StatCardProps) {
  return (
    <div className="bg-white px-5 py-5">
      <p className="eyebrow mb-2">
        {label}
      </p>
      {isLoading ? (
        <div className="h-9 w-24 bg-paper-200 mt-1" />
      ) : (
        <p
          className="text-ink-900 leading-none tabular"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 40,
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </p>
      )}
    </div>
  )
}
