/**
 * tRPC client setup — typed RPC alongside existing httpProvider.
 *
 * Panels can migrate incrementally from httpProvider to tRPC hooks:
 *   // Old: const { data } = useFileList(path)
 *   // New: const { data } = trpc.files.list.useQuery({ path })
 *
 * Both coexist during migration. No big-bang rewrite.
 */
import { createTRPCReact, httpBatchLink } from '@trpc/react-query'
import type { AppRouter } from '../../server/trpc/router.js'

// Create typed tRPC React hooks
export const trpc = createTRPCReact<AppRouter>()

/**
 * Create tRPC client configuration.
 * Points at the Fastify tRPC handler mounted at /trpc.
 */
export function createTrpcClient(baseUrl?: string) {
  const url = baseUrl || `${window.location.origin}/trpc`

  return trpc.createClient({
    links: [
      httpBatchLink({
        url,
        // Include cookies (boring_session) on every request
        fetch(url, options) {
          return fetch(url, {
            ...options,
            credentials: 'include',
          })
        },
      }),
    ],
  })
}
