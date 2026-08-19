export interface UploadFileOptions {
  apiBaseUrl?: string
  workspaceRequestId?: string | null
  directory?: string
  sourcePath?: string
  /** Preserve the exact leaf filename in `directory` (workspace file-tree mode). */
  preserveName?: boolean
  /** Collision behavior for exact-name uploads. Defaults to `error`. */
  collision?: 'replace' | 'skip' | 'error'
  responseUrl?: 'markdown' | 'raw'
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
}

export interface UploadFileResult {
  url: string
  path: string
  /** True when collision handling intentionally skipped the write. */
  skipped?: boolean
  reason?: string
}

function abortError(): DOMException {
  return new DOMException('Upload aborted', 'AbortError')
}

function readAsDataUrl(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const reader = new FileReader()
    const cleanup = () => signal?.removeEventListener('abort', handleAbort)
    const handleAbort = () => {
      reader.abort()
      cleanup()
      reject(abortError())
    }
    reader.onload = () => {
      cleanup()
      resolve(reader.result as string)
    }
    reader.onerror = () => {
      cleanup()
      reject(reader.error ?? new Error('Read failed'))
    }
    reader.onabort = () => {
      cleanup()
      reject(abortError())
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
    reader.readAsDataURL(file)
  })
}

export async function uploadFile(
  file: File,
  opts: UploadFileOptions = {},
): Promise<UploadFileResult> {
  const {
    apiBaseUrl = '',
    workspaceRequestId,
    directory,
    sourcePath,
    preserveName,
    collision,
    responseUrl = 'markdown',
    signal,
    fetch: fetchImpl = globalThis.fetch,
  } = opts

  const dataUrl = await readAsDataUrl(file, signal)
  const comma = dataUrl.indexOf(',')
  const contentBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (workspaceRequestId) headers['x-boring-workspace-id'] = workspaceRequestId

  const base = apiBaseUrl.replace(/\/$/, '')
  const res = await fetchImpl(`${base}/api/v1/files/upload`, {
    method: 'POST',
    headers,
    credentials: 'include',
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      contentBase64,
      ...(directory ? { directory } : {}),
      ...(sourcePath ? { sourcePath } : {}),
      ...(preserveName ? { preserveName: true } : {}),
      ...(collision ? { collision } : {}),
    }),
  })

  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)

  const body = (await res.json()) as { markdownUrl?: string; path?: string; skipped?: boolean; reason?: string }
  const path = body.path
  const status = {
    ...(body.skipped !== undefined ? { skipped: body.skipped } : {}),
    ...(body.reason ? { reason: body.reason } : {}),
  }
  if (responseUrl === 'raw') {
    if (!path) throw new Error('Upload response missing path')
    return { url: rawWorkspaceFileUrl(path, { apiBaseUrl, workspaceRequestId }), path, ...status }
  }

  const url = body.markdownUrl ?? path
  if (!url) throw new Error('Upload response missing url')
  return { url, path: path ?? url, ...status }
}

function rawWorkspaceFileUrl(
  path: string,
  opts: { apiBaseUrl?: string; workspaceRequestId?: string | null },
): string {
  const base = (opts.apiBaseUrl ?? '').replace(/\/$/, '')
  const params = new URLSearchParams({ path })
  if (opts.workspaceRequestId) params.set('workspaceId', opts.workspaceRequestId)
  return `${base}/api/v1/files/raw?${params.toString()}`
}
