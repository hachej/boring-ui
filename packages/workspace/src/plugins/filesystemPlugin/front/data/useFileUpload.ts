import { useCallback, useState } from 'react'
import { uploadFile } from '@hachej/boring-agent/front'
import type { UploadFileResult } from '@hachej/boring-agent/front'
import { useApiBaseUrl, useWorkspaceRequestId } from './DataProvider'

export interface UseFileUploadOptions {
  directory?: string
}

export interface UseFileUploadResult {
  upload: (file: File, opts?: { sourcePath?: string; directory?: string }) => Promise<UploadFileResult>
  uploading: boolean
}

export function useFileUpload(opts?: UseFileUploadOptions): UseFileUploadResult {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const [count, setCount] = useState(0)

  const upload = useCallback(
    async (file: File, extra?: { sourcePath?: string; directory?: string }) => {
      setCount((n) => n + 1)
      try {
        return await uploadFile(file, {
          apiBaseUrl,
          workspaceRequestId,
          directory: extra?.directory ?? opts?.directory,
          sourcePath: extra?.sourcePath,
        })
      } finally {
        setCount((n) => n - 1)
      }
    },
    [apiBaseUrl, workspaceRequestId, opts?.directory],
  )

  return { upload, uploading: count > 0 }
}
