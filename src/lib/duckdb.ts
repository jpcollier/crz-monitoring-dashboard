import * as duckdb from '@duckdb/duckdb-wasm'

const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles()

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

function initDb(): Promise<duckdb.AsyncDuckDB> {
  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' }),
    )
    const worker = new Worker(workerUrl)
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    URL.revokeObjectURL(workerUrl)

    const conn = await db.connect()

    // DuckDB-Wasm fetches Parquet files over HTTP — it needs absolute URLs,
    // not bare paths. window.location.origin covers both localhost dev and
    // the production Vercel domain without any hardcoding.
    const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '')
    const dailyUrl = `${base}/data/crz_daily.parquet`
    const hourlyUrl = `${base}/data/crz_hourly.parquet`

    // Register the pre-aggregated Parquet files as persistent views so every
    // query in the app can reference them by the simple names `daily` and `hourly`.
    await conn.query(`
      CREATE VIEW IF NOT EXISTS daily AS
      SELECT * FROM parquet_scan('${dailyUrl}');
    `)
    await conn.query(`
      CREATE VIEW IF NOT EXISTS hourly AS
      SELECT * FROM parquet_scan('${hourlyUrl}');
    `)

    await conn.close()
    return db
  })()

  return dbPromise
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  // reason: duckdb-wasm prepared statements use positional params via query(),
  // not named params, so we accept a plain array here.
  params: unknown[] = [],
): Promise<T[]> {
  const db = await initDb()
  const conn = await db.connect()
  try {
    const stmt = await conn.prepare(sql)
    const result = await stmt.query(...params)
    await stmt.close()
    return result.toArray().map((row) => row.toJSON() as T)
  } finally {
    await conn.close()
  }
}
