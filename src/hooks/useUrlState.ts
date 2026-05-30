import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseISODateOnly } from '../lib/alignment'
import type { DayType, EntryType, FilterState, PeriodPreset } from '../lib/types'

const VALID_PRESETS = new Set<PeriodPreset>(['ytd', 'last_month', 'last_week', 'custom'])
const VALID_ENTRY_TYPES = new Set<EntryType>(['CRZ', 'Excluded', 'Combined'])
const VALID_DAY_TYPES = new Set<DayType>(['all', 'weekday', 'weekend'])

const DEFAULTS: FilterState = {
  preset: 'ytd',
  entryType: 'CRZ',
  dayType: 'all',
}

function parsePreset(raw: string | null): PeriodPreset {
  return raw && VALID_PRESETS.has(raw as PeriodPreset) ? (raw as PeriodPreset) : DEFAULTS.preset
}

function parseEntryType(raw: string | null): EntryType {
  return raw && VALID_ENTRY_TYPES.has(raw as EntryType) ? (raw as EntryType) : DEFAULTS.entryType
}

function parseDayType(raw: string | null): DayType {
  return raw && VALID_DAY_TYPES.has(raw as DayType) ? (raw as DayType) : DEFAULTS.dayType
}

function parseISODate(raw: string | null): string | undefined {
  if (!raw) return undefined
  return parseISODateOnly(raw) ? raw : undefined
}

export function useUrlState(): [FilterState, (next: Partial<FilterState>) => void] {
  const [params, setParams] = useSearchParams()

  const state: FilterState = {
    preset: parsePreset(params.get('preset')),
    entryType: parseEntryType(params.get('entryType')),
    dayType: parseDayType(params.get('dayType')),
    customStart: parseISODate(params.get('customStart')),
    customEnd: parseISODate(params.get('customEnd')),
  }

  const setState = useCallback(
    (next: Partial<FilterState>) => {
      setParams(
        (prev) => {
          const merged: FilterState = {
            preset: parsePreset(prev.get('preset')),
            entryType: parseEntryType(prev.get('entryType')),
            dayType: parseDayType(prev.get('dayType')),
            customStart: parseISODate(prev.get('customStart')),
            customEnd: parseISODate(prev.get('customEnd')),
            ...next,
          }
          const p = new URLSearchParams()
          p.set('preset', merged.preset)
          p.set('entryType', merged.entryType)
          if (merged.dayType !== DEFAULTS.dayType) p.set('dayType', merged.dayType)
          if (merged.preset === 'custom') {
            if (merged.customStart) p.set('customStart', merged.customStart)
            if (merged.customEnd) p.set('customEnd', merged.customEnd)
          }
          return p
        },
        { replace: false },
      )
    },
    [setParams],
  )

  return [state, setState]
}
