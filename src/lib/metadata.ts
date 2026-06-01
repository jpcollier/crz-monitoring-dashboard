import metadata from '../../public/data/metadata.json'
import { parseISODateOnly } from './alignment'

export const SOURCE_DATASET_NAME = 'MTA Congestion Relief Zone Vehicle Entries: Beginning 2025'
export const SOURCE_DATASET_URL = 'https://data.ny.gov/Transportation/MTA-Congestion-Relief-Zone-Vehicle-Entries-Beginni/t6yz-b64h'
export const DATA_AS_OF = metadata.data_as_of

export interface DataWindow {
  currentStart: Date
  currentEnd: Date
}

export function formatDisplayDate(isoDate: string): string {
  const parsed = parseISODateOnly(isoDate)
  if (!parsed) throw new Error(`Invalid ISO date: ${isoDate}`)

  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function requireDate(value: string, field: string): Date {
  const parsed = parseISODateOnly(value)
  if (!parsed) throw new Error(`metadata.${field} must be a YYYY-MM-DD date`)
  return parsed
}

const configuredWindowEnd = requireDate(metadata.current_window_end, 'current_window_end')
export const DATA_WINDOW: DataWindow = {
  currentStart: requireDate(metadata.current_window_start, 'current_window_start'),
  currentEnd: configuredWindowEnd,
}
