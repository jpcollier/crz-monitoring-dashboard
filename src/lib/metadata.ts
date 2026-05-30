import metadata from '../../public/data/metadata.json'
import { parseISODateOnly } from './alignment'

export interface DataWindow {
  currentStart: Date
  currentEnd: Date
}

function requireDate(value: string, field: string): Date {
  const parsed = parseISODateOnly(value)
  if (!parsed) throw new Error(`metadata.${field} must be a YYYY-MM-DD date`)
  return parsed
}

function earliestDate(a: Date, b: Date): Date {
  return a < b ? a : b
}

const configuredWindowEnd = requireDate(metadata.current_window_end, 'current_window_end')
const dataBackedWindowEnd = requireDate(metadata.data_as_of, 'data_as_of')

export const DATA_WINDOW: DataWindow = {
  currentStart: requireDate(metadata.current_window_start, 'current_window_start'),
  currentEnd: earliestDate(configuredWindowEnd, dataBackedWindowEnd),
}
