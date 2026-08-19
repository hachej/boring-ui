import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadFile } from '@hachej/boring-agent/front'
import type { UploadFileResult } from '@hachej/boring-agent/front'
import { useApiBaseUrl, useWorkspaceRequestId } from './DataProvider'

export interface UseFileUploadOptions {
  directory?: string
}

export interface UseFileUploadResult {
  upload: (file: File, opts?: {
    sourcePath?: string
    directory?: string
    preserveName?: boolean
    collision?: 'replace' | 'skip' | 'error'
    signal?: AbortSignal
  }) => Promise<UploadFileResult>
  uploading: boolean
}

export function useFileUpload(opts?: UseFileUploadOptions): UseFileUploadResult {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const [count, setCount] = useState(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const upload = useCallback(
    async (file: File, extra?: {
      sourcePath?: string
      directory?: string
      preserveName?: boolean
      collision?: 'replace' | 'skip' | 'error'
      signal?: AbortSignal
    }) => {
      if (mountedRef.current) setCount((n) => n + 1)
      try {
        return await uploadFile(file, {
          apiBaseUrl,
          workspaceRequestId,
          directory: extra?.directory ?? opts?.directory,
          sourcePath: extra?.sourcePath,
          ...(extra?.preserveName ? { preserveName: true } : {}),
          ...(extra?.collision ? { collision: extra.collision } : {}),
          ...(extra?.signal ? { signal: extra.signal } : {}),
        })
      } finally {
        if (mountedRef.current) setCount((n) => n - 1)
      }
    },
    [apiBaseUrl, workspaceRequestId, opts?.directory],
  )

  return { upload, uploading: count > 0 }
}
