export type EntryType = 'CRZ' | 'Excluded' | 'Combined'

export type PeriodPreset = 'ytd' | 'last_90_days' | 'last_30_days' | 'custom'

export type DayType = 'all' | 'weekday' | 'weekend'

export interface FilterState {
  preset: PeriodPreset
  entryType: EntryType
  dayType: DayType
  customStart?: string
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
