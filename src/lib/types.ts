export type EntryType = 'CRZ' | 'Excluded' | 'Combined'

export type PeriodPreset = 'ytd' | 'last_month' | 'last_week' | 'custom'

export interface FilterState {
  preset: PeriodPreset
  entryType: EntryType
  customStart?: string // ISO date string, only when preset === 'custom'
  customEnd?: string
}

export interface DailyRow {
  date: string
  detection_group: string
  vehicle_class: string
  entry_type: 'CRZ' | 'Excluded'
  entries: number
  comparison_date: string | null
}

export interface HourlyRow {
  date: string
  hour: number
  detection_group: string
  vehicle_class: string
  entry_type: 'CRZ' | 'Excluded'
  entries: number
  comparison_date: string | null
}
