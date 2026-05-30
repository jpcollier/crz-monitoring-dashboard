import { type DependencyList, useEffect, useRef, useState } from 'react'

interface QueryState<T> {
  data: T[]
  isLoading: boolean
  error: Error | null
}

interface QueryOptions {
  enabled?: boolean
}

/**
 * Run an async query function whenever `deps` change.
 * Pass a function from `src/lib/queries.ts` — never construct SQL here.
 *
 * @param fn  Async function that returns T[]. Re-called whenever deps change.
 * @param deps  Dependency array (same semantics as useEffect deps).
 */
export function useDuckQuery<T>(
  fn: () => Promise<T[]>,
  deps: DependencyList,
  options: QueryOptions = {},
): QueryState<T> {
  const enabled = options.enabled ?? true
  const [state, setState] = useState<QueryState<T>>({
    data: [],
    isLoading: enabled,
    error: null,
  })

  // Keep a stable ref to fn so we don't need callers to memoize it.
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false

    if (!enabled) {
      setState({ data: [], isLoading: false, error: null })
      return () => {
        cancelled = true
      }
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    fnRef.current()
      .then((data) => {
        if (!cancelled) setState({ data, isLoading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ data: [], isLoading: false, error: err instanceof Error ? err : new Error(String(err)) })
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled])

  return state
}
