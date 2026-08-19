export interface UploadFileOptions {
  apiBaseUrl?: string
  workspaceRequestId?: string | null
  directory?: string
  sourcePath?: string
  responseUrl?: 'markdown' | 'raw'
  fetch?: typeof globalThis.fetch
}

export interface UploadFileResult {
  url: string
  path: string
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'))
    reader.readAsDataURL(file)
  })
}

export async function uploadFile(
  file: File,
  opts: UploadFileOptions = {},
): Promise<UploadFileResult> {
  const { apiBaseUrl = '', workspaceRequestId, directory, sourcePath, responseUrl = 'markdown', fetch: fetchImpl = globalThis.fetch } = opts

  const dataUrl = await readAsDataUrl(file)
  const comma = dataUrl.indexOf(',')
  const contentBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (workspaceRequestId) headers['x-boring-workspace-id'] = workspaceRequestId

  const base = apiBaseUrl.replace(/\/$/, '')
  const res = await fetchImpl(`${base}/api/v1/files/upload`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      contentBase64,
      ...(directory ? { directory } : {}),
      ...(sourcePath ? { sourcePath } : {}),
    }),
  })

  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)

  const body = (await res.json()) as { markdownUrl?: string; path?: string }
  const path = body.path
  if (responseUrl === 'raw') {
    if (!path) throw new Error('Upload response missing path')
    return { url: rawWorkspaceFileUrl(path, { apiBaseUrl, workspaceRequestId }), path }
  }

  const url = body.markdownUrl ?? path
  if (!url) throw new Error('Upload response missing url')
  return { url, path: path ?? url }
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
