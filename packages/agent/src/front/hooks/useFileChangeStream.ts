import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

interface FileChangedDataPart {
  type: 'data-file-changed'
  data: {
    op: 'write' | 'edit' | 'unlink' | 'rename' | 'mkdir'
    path: string
    oldPath?: string
    toolCallId: string
    timestamp: string
    size?: number
  }
}

interface QueryClientLike {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFileChangedDataPart(part: unknown): part is FileChangedDataPart {
  if (!isRecord(part) || part.type !== 'data-file-changed') {
    return false
  }

  const data = part.data
  if (!isRecord(data)) {
    return false
  }

  return typeof data.path === 'string' && data.path.length > 0
}

export function useFileChangeStream() {
  let queryClient: QueryClientLike | null = null
  try {
    queryClient = useQueryClient() as unknown as QueryClientLike
  } catch {
    // ChatPanel can render without React Query; no-op in that case.
  }

  const onData = useCallback((part: unknown) => {
    if (!queryClient || !isFileChangedDataPart(part)) {
      return
    }

    queryClient.invalidateQueries({ queryKey: ['tree'] })
    queryClient.invalidateQueries({ queryKey: ['file', part.data.path] })
    if (typeof part.data.oldPath === 'string' && part.data.oldPath.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['file', part.data.oldPath] })
    }
  }, [queryClient])

  return { onData }
}

