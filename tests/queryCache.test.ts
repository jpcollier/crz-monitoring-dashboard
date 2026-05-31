import { describe, expect, it } from 'vitest'
import { createQueryResultCache, makeQueryCacheKey } from '../src/lib/queryCache'

describe('makeQueryCacheKey', () => {
  it('normalizes SQL whitespace and includes params and data version', () => {
    const keyA = makeQueryCacheKey({
      sql: ' SELECT *\nFROM daily WHERE entry_type = ? ',
      params: ['CRZ'],
      version: 'schema-1:data-2026-05-24',
    })
    const keyB = makeQueryCacheKey({
      sql: 'SELECT * FROM daily WHERE entry_type = ?',
      params: ['CRZ'],
      version: 'schema-1:data-2026-05-24',
    })
    const keyC = makeQueryCacheKey({
      sql: 'SELECT * FROM daily WHERE entry_type = ?',
      params: ['Excluded'],
      version: 'schema-1:data-2026-05-24',
    })
    const keyD = makeQueryCacheKey({
      sql: 'SELECT * FROM daily WHERE entry_type = ?',
      params: ['CRZ'],
      version: 'schema-1:data-2026-05-31',
    })

    expect(keyA).toBe(keyB)
    expect(keyA).not.toBe(keyC)
    expect(keyA).not.toBe(keyD)
  })
})

describe('createQueryResultCache', () => {
  it('reuses a resolved result for repeated keys', async () => {
    const cache = createQueryResultCache({ maxEntries: 4 })
    let calls = 0

    const first = await cache.getOrLoad({ sql: 'SELECT 1', version: 'v1' }, async () => {
      calls += 1
      return [{ value: 1 }]
    })
    const second = await cache.getOrLoad({ sql: ' SELECT   1 ', version: 'v1' }, async () => {
      calls += 1
      return [{ value: 2 }]
    })

    expect(calls).toBe(1)
    expect(second).toBe(first)
    expect(second).toEqual([{ value: 1 }])
  })

  it('dedupes concurrent loads for the same key', async () => {
    const cache = createQueryResultCache({ maxEntries: 4 })
    let calls = 0
    let release!: (rows: { value: number }[]) => void

    const loader = () => {
      calls += 1
      return new Promise<{ value: number }[]>((resolve) => {
        release = resolve
      })
    }

    const first = cache.getOrLoad({ sql: 'SELECT 1', version: 'v1' }, loader)
    const second = cache.getOrLoad({ sql: 'SELECT 1', version: 'v1' }, loader)
    release([{ value: 1 }])

    await expect(first).resolves.toEqual([{ value: 1 }])
    await expect(second).resolves.toEqual([{ value: 1 }])
    expect(calls).toBe(1)
  })

  it('evicts failed loads so the query can be retried', async () => {
    const cache = createQueryResultCache({ maxEntries: 4 })
    let calls = 0

    await expect(
      cache.getOrLoad({ sql: 'SELECT broken', version: 'v1' }, async () => {
        calls += 1
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const retried = await cache.getOrLoad({ sql: 'SELECT broken', version: 'v1' }, async () => {
      calls += 1
      return [{ ok: true }]
    })

    expect(calls).toBe(2)
    expect(retried).toEqual([{ ok: true }])
  })

  it('evicts the least recently used result when full', async () => {
    const cache = createQueryResultCache({ maxEntries: 2 })
    let calls = 0

    await cache.getOrLoad({ sql: 'SELECT 1', version: 'v1' }, async () => {
      calls += 1
      return [{ value: 1 }]
    })
    await cache.getOrLoad({ sql: 'SELECT 2', version: 'v1' }, async () => {
      calls += 1
      return [{ value: 2 }]
    })
    await cache.getOrLoad({ sql: 'SELECT 1', version: 'v1' }, async () => {
      calls += 1
      return [{ value: 10 }]
    })
    await cache.getOrLoad({ sql: 'SELECT 3', version: 'v1' }, async () => {
      calls += 1
      return [{ value: 3 }]
    })
    const reloaded = await cache.getOrLoad({ sql: 'SELECT 2', version: 'v1' }, async () => {
      calls += 1
      return [{ value: 20 }]
    })

    expect(calls).toBe(4)
    expect(reloaded).toEqual([{ value: 20 }])
  })
})
