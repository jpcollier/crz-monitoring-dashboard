interface StatCardProps {
  label: string
  value: React.ReactNode
  isLoading?: boolean
}

export default function StatCard({ label, value, isLoading = false }: StatCardProps) {
  return (
    <div className="bg-white px-3 py-4 sm:px-5 sm:py-5">
      <p className="eyebrow mb-2">
        {label}
      </p>
      {isLoading ? (
        <div className="h-9 w-24 bg-paper-200 mt-1" />
      ) : (
        <p
          className="text-[28px] leading-none text-ink-900 tabular sm:text-[40px]"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            letterSpacing: 0,
          }}
        >
          {value}
        </p>
      )}
    </div>
  )
}
