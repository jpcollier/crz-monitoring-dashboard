import { useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { DATA_AS_OF, SOURCE_DATASET_NAME, SOURCE_DATASET_URL, formatDisplayDate } from './lib/metadata'
import DailyEntriesView from './views/DailyEntriesView'
import HourlyProfilesView from './views/HourlyProfilesView'

const dataAsOfLabel = formatDisplayDate(DATA_AS_OF)

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors border-r border-ink-900 last:border-r-0 ${
          isActive
            ? 'bg-ink-900 text-paper-50'
            : 'bg-white text-ink-900 hover:bg-paper-200'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

function InfoModal({ onClose }: { onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close dashboard information"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-info-title"
        className="absolute left-1/2 top-1/2 w-[calc(100vw-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 border border-ink-900 bg-white p-4 shadow-[6px_6px_0_#111111] sm:p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="dashboard-info-title"
            className="text-base font-bold leading-tight text-ink-900"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            About this dashboard
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close information modal"
            className="flex h-8 w-8 shrink-0 items-center justify-center border border-ink-900 bg-white text-sm font-semibold text-ink-900 hover:bg-paper-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
          >
            x
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          This dashboard visualizes MTA Congestion Relief Zone vehicle entry data, comparing 2026 to weekday-aligned 2025 totals. It includes systemwide daily entries, hourly profiles, detection group small multiples, and vehicle class detail views.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-600">
          Latest data available in this dashboard: {dataAsOfLabel}. Source:{' '}
          <a
            href={SOURCE_DATASET_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline decoration-ink-300 underline-offset-2 hover:text-signal-700"
          >
            {SOURCE_DATASET_NAME}
          </a>
          .
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-600">
          This is an independent dashboard and is not affiliated with or endorsed by the MTA.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const [isInfoOpen, setIsInfoOpen] = useState(false)

  return (
    <div className="min-h-screen bg-paper-100">
      <header>
        {/* 6px signal red masthead bar */}
        <div className="h-[6px] bg-signal-500 border-b border-ink-900" />
        {/* Header body */}
        <div className="border-b border-ink-900 bg-paper-100">
          <div className="max-w-[1240px] mx-auto px-8 flex items-center justify-between py-4 gap-8">
            {/* Wordmark */}
            <div className="min-w-0">
              <div
                className="font-display font-extrabold text-ink-900 leading-tight"
                style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}
              >
                Congestion Relief Zone Entries Dashboard
              </div>
              <div
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-snug text-ink-600"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                <span>Latest data available: {dataAsOfLabel}</span>
                <span aria-hidden="true" className="text-ink-300">/</span>
                <span>
                  Source:{' '}
                  <a
                    href={SOURCE_DATASET_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline decoration-ink-300 underline-offset-2 hover:text-signal-700"
                  >
                    NY Open Data
                  </a>
                </span>
                <span aria-hidden="true" className="text-ink-300">/</span>
                <button
                  type="button"
                  onClick={() => setIsInfoOpen(true)}
                  className="font-semibold underline decoration-ink-300 underline-offset-2 hover:text-signal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
                >
                  What is this?
                </button>
              </div>
            </div>

            {/* Segmented nav */}
            <nav className="flex border border-ink-900">
              <NavItem to="/daily" label="Daily Entries" />
              <NavItem to="/hourly" label="Hourly Profiles" />
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-[1240px] mx-auto px-8 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/daily" replace />} />
          <Route path="/daily" element={<DailyEntriesView />} />
          <Route path="/hourly" element={<HourlyProfilesView />} />
        </Routes>
      </main>

      {isInfoOpen && <InfoModal onClose={() => setIsInfoOpen(false)} />}
    </div>
  )
}
