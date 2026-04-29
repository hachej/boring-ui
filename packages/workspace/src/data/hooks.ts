"use client"

import {
  useQuery,
  useMutation,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query"
import { useRef, useState, useEffect } from "react"
import { useDataClient, useApiBaseUrl } from "./DataProvider"
import { FetchError } from "./fetchClient"
import { events, userMeta } from "../front/events"
import type { FileContent, FileEntry, FileStat } from "./types"

function noRetryOn404(count: number, error: Error): boolean {
  if (error instanceof FetchError && error.status === 404) return false
  return count < 3
}

export function useFileContent(path: string | null): UseQueryResult<FileContent> {
  const client = useDataClient()
  const base = useApiBaseUrl()
  return useQuery({
    queryKey: [base, "files", path],
    queryFn: () => client.getFile(path!),
    enabled: path != null,
    staleTime: 0,
    retry: noRetryOn404,
  })
}

export function useFileList(dir: string | null): UseQueryResult<FileEntry[]> {
  const client = useDataClient()
  const base = useApiBaseUrl()
  return useQuery({
    queryKey: [base, "tree", dir],
    queryFn: () => client.getTree(dir!),
    enabled: dir != null,
    staleTime: 3_000,
    refetchInterval: 3_000,
    retry: noRetryOn404,
  })
}

export function useStat(path: string | null): UseQueryResult<FileStat> {
  const client = useDataClient()
  const base = useApiBaseUrl()
  return useQuery({
    queryKey: [base, "stat", path],
    queryFn: () => client.stat(path!),
    enabled: path != null,
    retry: noRetryOn404,
  })
}

export function useFileSearch(
  query: string,
  limit?: number,
): UseQueryResult<string[]> {
  const client = useDataClient()
  const base = useApiBaseUrl()
  const [debounced, setDebounced] = useState(query)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  return useQuery({
    queryKey: [base, "search", debounced, limit],
    queryFn: () => client.search(debounced, limit),
    enabled: debounced.length > 0,
    retry: noRetryOn404,
  })
}

export interface FileWriteVariables {
  path: string
  content: string
  /**
   * Read-time mtime baseline for optimistic concurrency. When
   * supplied, the server returns 409 (surfaced as `FileConflictError`)
   * if the file has changed since. Omit to force-overwrite.
   */
  expectedMtimeMs?: number
}

export interface FileWriteResult {
  /** Server stat after the write — the next save's OCC baseline. */
  mtimeMs?: number
}

export function useFileWrite(): UseMutationResult<FileWriteResult, Error, FileWriteVariables> {
  const client = useDataClient()
  return useMutation({
    mutationFn: ({ path, content, expectedMtimeMs }) =>
      client.writeFile(path, content, expectedMtimeMs != null ? { expectedMtimeMs } : undefined),
    onSuccess: (_, { path }) => {
      // Single source of truth: emit onto the bus, the centralized
      // invalidator (`useFileEventInvalidation`) handles cache
      // invalidation. We can't tell create-vs-edit from the mutation
      // alone, so consumers wanting "created" emits do it themselves
      // at the call site (see FileTreeView.handleSubmitEdit). Plain
      // edits emit `file:changed` — file identity didn't change.
      events.emit("file:changed", { ...userMeta(), path })
    },
  })
}

export function useCreateDir(): UseMutationResult<void, Error, { path: string }> {
  const client = useDataClient()
  return useMutation({
    mutationFn: ({ path }) => client.createDir(path),
    onSuccess: (_, { path }) => {
      // Bus emit only — `useFileEventInvalidation` runs the cache invalidation.
      events.emit("file:created", { ...userMeta(), path, kind: "dir" })
    },
  })
}

export function useMoveFile(): UseMutationResult<void, Error, { from: string; to: string }> {
  const client = useDataClient()
  return useMutation({
    mutationFn: ({ from, to }) => client.moveFile(from, to),
    onSuccess: (_, { from, to }) => {
      events.emit("file:moved", { ...userMeta(), from, to })
    },
  })
}

export function useDeleteFile(): UseMutationResult<void, Error, { path: string }> {
  const client = useDataClient()
  return useMutation({
    mutationFn: ({ path }) => client.deleteFile(path),
    onSuccess: (_, { path }) => {
      events.emit("file:deleted", { ...userMeta(), path })
    },
  })
}
