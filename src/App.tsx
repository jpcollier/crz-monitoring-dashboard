import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import DailyEntriesView from './views/DailyEntriesView'
import HourlyProfilesView from './views/HourlyProfilesView'

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors border-r border-ink-900 last:border-r-0 ${
          isActive
            ? 'bg-ink-900 text-paper-50'
            : 'bg-transparent text-ink-900 hover:bg-paper-200'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-paper-100">
      <header>
        {/* 6px signal red masthead bar */}
        <div className="h-[6px] bg-signal-500 border-b border-ink-900" />
        {/* Header body */}
        <div className="border-b border-ink-900 bg-paper-100">
          <div className="max-w-[1240px] mx-auto px-8 flex items-center justify-between py-4 gap-8">
            {/* Wordmark */}
            <div>
              <div className="eyebrow mb-1">MTA · Congestion Relief Zone</div>
              <div
                className="font-display font-extrabold text-ink-900 leading-none tracking-tight"
                style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '-0.02em' }}
              >
                Vehicle Entries Monitor
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
    </div>
  )
}
