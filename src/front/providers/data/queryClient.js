import { QueryClient } from '@tanstack/react-query'

/**
 * Module-level singleton QueryClient.
 * Safe to call before React mounts (e.g. in entry-point setup scripts).
 *
 * @type {QueryClient | null}
 */
let instance = null

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000, // 5 s before background refetch
        gcTime: 5 * 60_000, // 5 min garbage-collection window
        retry: 1, // one automatic retry on failure
        refetchOnWindowFocus: true, // refetch stale queries on tab focus
      },
    },
  })

/**
 * Return (and lazily create) the singleton QueryClient.
 * @returns {QueryClient}
 */
export const getQueryClient = () => {
  if (!instance) {
    instance = createQueryClient()
  }
  return instance
}
