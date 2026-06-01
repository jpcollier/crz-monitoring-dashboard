import { describe, expect, it } from 'vitest'
import { LOCAL_DUCKDB_BUNDLES } from '../src/lib/duckdbBundles'

describe('LOCAL_DUCKDB_BUNDLES', () => {
  it('serves DuckDB workers and wasm from local Vite assets', () => {
    const urls = Object.values(LOCAL_DUCKDB_BUNDLES).flatMap((bundle) => [
      bundle.mainModule,
      bundle.mainWorker,
    ])

    expect(urls).toHaveLength(4)
    for (const url of urls) {
      expect(url).toBeTruthy()
      expect(url).not.toMatch(/^https?:\/\//)
      expect(url).not.toContain('jsdelivr')
    }
  })
})
