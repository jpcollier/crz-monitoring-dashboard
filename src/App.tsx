import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import DailyEntriesView from './views/DailyEntriesView'
import HourlyProfilesView from './views/HourlyProfilesView'

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-4 py-1.5 text-sm rounded-full transition-colors ${
          isActive
            ? 'bg-gray-800 text-white font-medium'
            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 font-normal'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-5">
            {/* Wordmark + subtitle */}
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight tracking-tight">
                MTA Congestion Relief Zone
              </h1>
              <p className="mt-1 text-[13px] text-gray-500 leading-snug">
                Daily vehicle entries into the Congestion Relief Zone and excluded roadways
              </p>
            </div>

            {/* View tabs */}
            <nav className="flex items-center gap-1">
              <NavItem to="/daily" label="Daily Entries" />
              <NavItem to="/hourly" label="Hourly Profiles" />
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/daily" replace />} />
          <Route path="/daily" element={<DailyEntriesView />} />
          <Route path="/hourly" element={<HourlyProfilesView />} />
        </Routes>
      </main>
    </div>
  )
}
