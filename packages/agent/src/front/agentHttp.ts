export function agentResourceUrl(apiBaseUrl: string | undefined, path: string): string {
  const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
  return `${base}${path}`
}

export function withStorageScope(
  requestHeaders: Record<string, string | undefined> | undefined,
  storageScope: string | undefined,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(requestHeaders ?? {})) {
    if (value !== undefined) headers[key] = value
  }
  const hasStorageScope = Object.keys(headers).some((key) => key.toLowerCase() === 'x-boring-storage-scope')
  if (storageScope && !hasStorageScope) headers['x-boring-storage-scope'] = storageScope
  return Object.keys(headers).length > 0 ? headers : undefined
}

export function createRequestId(operation: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${operation}:${suffix}`
}
