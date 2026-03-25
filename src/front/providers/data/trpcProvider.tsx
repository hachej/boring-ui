/**
 * tRPC + React Query provider — wraps the app to enable tRPC hooks.
 *
 * Usage in App.jsx:
 *   import { TRPCProvider } from './providers/data/trpcProvider'
 *   <TRPCProvider>
 *     <App />
 *   </TRPCProvider>
 */
import React, { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { trpc, createTrpcClient } from '../../utils/trpc'

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            retry: 1,
          },
        },
      }),
  )

  const [trpcClient] = useState(() => createTrpcClient())

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  )
}
