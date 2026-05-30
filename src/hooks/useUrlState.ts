import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DATA_WINDOW } from '../lib/metadata'
import type { DataWindow } from '../lib/metadata'
import type { DayType, EntryType, FilterState, PeriodPreset } from '../lib/types'

const VALID_PRESETS = new Set<PeriodPreset>(['ytd', 'last_90_days', 'last_30_days'])
const VALID_ENTRY_TYPES = new Set<EntryType>(['CRZ', 'Excluded', 'Combined'])
const VALID_DAY_TYPES = new Set<DayType>(['all', 'weekday', 'weekend'])

const DEFAULTS: FilterState = {
  preset: 'ytd',
  entryType: 'CRZ',
  dayType: 'all',
}

function parsePreset(raw: string | null): PeriodPreset {
  if (raw === 'last_month') return 'last_90_days'
  if (raw === 'last_week') return 'last_30_days'
  return raw && VALID_PRESETS.has(raw as PeriodPreset) ? (raw as PeriodPreset) : DEFAULTS.preset
}

function parseEntryType(raw: string | null): EntryType {
  return raw && VALID_ENTRY_TYPES.has(raw as EntryType) ? (raw as EntryType) : DEFAULTS.entryType
}

function parseDayType(raw: string | null): DayType {
  return raw && VALID_DAY_TYPES.has(raw as DayType) ? (raw as DayType) : DEFAULTS.dayType
}

export function parseUrlFilterState(
  params: URLSearchParams,
  _dataWindow: DataWindow = DATA_WINDOW,
): FilterState {
  return {
    preset: parsePreset(params.get('preset')),
    entryType: parseEntryType(params.get('entryType')),
    dayType: parseDayType(params.get('dayType')),
  }
}

export function useUrlState(
  dataWindow: DataWindow = DATA_WINDOW,
): [FilterState, (next: Partial<FilterState>) => void] {
  const [params, setParams] = useSearchParams()

  const state = parseUrlFilterState(params, dataWindow)

  const setState = useCallback(
    (next: Partial<FilterState>) => {
      setParams(
        (prev) => {
          const merged: FilterState = {
            ...parseUrlFilterState(prev, dataWindow),
            ...next,
          }
          const p = new URLSearchParams()
          p.set('preset', merged.preset)
          p.set('entryType', merged.entryType)
          if (merged.dayType !== DEFAULTS.dayType) p.set('dayType', merged.dayType)
          return p
        },
        { replace: false },
      )
    },
    [dataWindow, setParams],
  )

  return [state, setState]
}
