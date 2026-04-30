"use client"

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { FetchClient } from "./fetchClient"
import { useFileEventInvalidation } from "./useFileEventInvalidation"
import { useFileEventStream } from "./useFileEventStream"

interface DataProviderProps {
  apiBaseUrl: string
  authHeaders?: Record<string, string>
  onAuthError?: (statusCode: number) => void
  timeout?: number
  children: ReactNode
}

const FetchClientContext = createContext<FetchClient | null>(null)
const ApiBaseUrlContext = createContext<string>("")
const WorkspaceRequestIdContext = createContext<string | null>(null)

export function useDataClient(): FetchClient {
  const ctx = useContext(FetchClientContext)
  if (!ctx) throw new Error("useDataClient must be used within a DataProvider")
  return ctx
}

export function useApiBaseUrl(): string {
  return useContext(ApiBaseUrlContext)
}

export function useWorkspaceRequestId(): string | null {
  return useContext(WorkspaceRequestIdContext)
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
  const workspaceRequestId =
    authHeaders?.["x-boring-workspace-id"] ??
    authHeaders?.["X-Boring-Workspace-Id"] ??
    null

  return (
    <QueryClientProvider client={queryClientRef.current}>
      <ApiBaseUrlContext.Provider value={apiBaseUrl}>
        <WorkspaceRequestIdContext.Provider value={workspaceRequestId}>
          <FetchClientContext.Provider value={client}>
            <FileEventInvalidationMount />
            {children}
          </FetchClientContext.Provider>
        </WorkspaceRequestIdContext.Provider>
      </ApiBaseUrlContext.Provider>
    </QueryClientProvider>
  )
}

/**
 * Side-effect-only child that wires the workspace's two file-event
 * pipelines:
 *   1. SSE stream from /api/v1/fs/events → emit onto workspace bus
 *      with cause:"remote".
 *   2. Bus `file:*` subscriber → React Query invalidation.
 *
 * Mounted as a sibling of `children` so the subscriptions run whether
 * or not consumers render any file-aware UI.
 */
function FileEventInvalidationMount() {
  useFileEventInvalidation()
  useFileEventStream()
  return null
}
