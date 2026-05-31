export interface QueryCacheKeyInput {
  sql: string
  params?: readonly unknown[]
  version: string
}

export interface QueryResultCacheOptions {
  maxEntries?: number
}

interface CacheEntry<T> {
  promise: Promise<T>
}

const DEFAULT_MAX_ENTRIES = 50

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ')
}

function normalizeParam(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(normalizeParam)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, normalizeParam(item)])
    return Object.fromEntries(entries)
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeParam(value)) ?? 'undefined'
}

export function makeQueryCacheKey({ sql, params = [], version }: QueryCacheKeyInput): string {
  return stableStringify({
    version,
    sql: normalizeSql(sql),
    params,
  })
}

export function createQueryResultCache(options: QueryResultCacheOptions = {}) {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const entries = new Map<string, CacheEntry<unknown>>()

  function touch(key: string, entry: CacheEntry<unknown>) {
    entries.delete(key)
    entries.set(key, entry)
  }

  function evictIfNeeded() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value
      if (oldestKey === undefined) return
      entries.delete(oldestKey)
    }
  }

  function getOrLoad<T>(keyInput: QueryCacheKeyInput, loader: () => Promise<T>): Promise<T> {
    const key = makeQueryCacheKey(keyInput)
    const cached = entries.get(key)
    if (cached) {
      touch(key, cached)
      return cached.promise as Promise<T>
    }

    const entry: CacheEntry<T> = {
      promise: loader().catch((error: unknown) => {
        entries.delete(key)
        throw error
      }),
    }
    entries.set(key, entry as CacheEntry<unknown>)
    evictIfNeeded()
    return entry.promise
  }

  return {
    getOrLoad,
    clear: () => entries.clear(),
    size: () => entries.size,
  }
}
