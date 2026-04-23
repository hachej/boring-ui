"use client"

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FetchClient } from "./fetchClient"

interface DataProviderProps {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  onAuthError?: (statusCode: number) => void
  timeout?: number
  children: ReactNode
}

const FetchClientContext = createContext<FetchClient | null>(null)
const ApiBaseUrlContext = createContext<string>("")

export function useDataClient(): FetchClient {
  const ctx = useContext(FetchClientContext)
  if (!ctx) throw new Error("useDataClient must be used within a DataProvider")
  return ctx
}

export function useApiBaseUrl(): string {
  return useContext(ApiBaseUrlContext)
}

export function DataProvider({
  apiBaseUrl,
  authHeaders,
  onAuthError,
  timeout,
  children,
}: DataProviderProps) {
  const queryClientRef = useRef<QueryClient | null>(null)
  if (!queryClientRef.current) {
    queryClientRef.current = new QueryClient({
      defaultOptions: {
        queries: {
          retry: 3,
          retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
        },
      },
    })
  }

  const client = useMemo(
    () => new FetchClient({ apiBaseUrl, authHeaders, onAuthError, timeout }),
    [apiBaseUrl, authHeaders, onAuthError, timeout],
  )

  return (
    <QueryClientProvider client={queryClientRef.current}>
      <ApiBaseUrlContext.Provider value={apiBaseUrl}>
        <FetchClientContext.Provider value={client}>
          {children}
        </FetchClientContext.Provider>
      </ApiBaseUrlContext.Provider>
    </QueryClientProvider>
  )
}
