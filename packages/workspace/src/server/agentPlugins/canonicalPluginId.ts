import { isValidBoringPluginId } from '../../shared/plugins/manifest'

export const CANONICAL_PLUGIN_ID_ERROR_CODE = 'BORING_PLUGIN_ID_MISMATCH'

export class CanonicalPluginIdError extends Error {
  readonly code = CANONICAL_PLUGIN_ID_ERROR_CODE

  constructor(message: string) {
    super(message)
    this.name = 'CanonicalPluginIdError'
  }
}

export interface CanonicalPluginIdInput {
  readonly packageJson: {
    readonly name?: unknown
    readonly boring?: { readonly id?: unknown }
  }
  readonly frontId?: unknown
  readonly serverId?: unknown
  readonly source?: string
}

export function extractDefinePluginId(source: string): string | undefined {
  const match = source.match(/definePlugin\s*\(\s*\{[\s\S]*?\bid\s*:\s*(["'`])([^"'`]+)\1/)
  return match?.[2]
}

/**
 * App-side preflight join-key validation. It runs before contribution
 * collection; the Agent Host receives only this validated canonical ID.
 */
export function assertCanonicalPluginId(input: CanonicalPluginIdInput): string {
  const packageName = typeof input.packageJson.name === 'string'
    ? input.packageJson.name.trim()
    : ''
  const manifestId = typeof input.packageJson.boring?.id === 'string'
    ? input.packageJson.boring.id.trim()
    : ''
  const canonicalId = manifestId || packageName
  const source = input.source ? ` in ${input.source}` : ''
  if (!canonicalId || !isValidBoringPluginId(canonicalId)) {
    throw new CanonicalPluginIdError(`boring plugin canonical ID is missing or unsafe${source}`)
  }
  for (const [site, value] of [['definePlugin', input.frontId], ['defineServerPlugin', input.serverId]] as const) {
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim() !== canonicalId) {
      throw new CanonicalPluginIdError(
        `${site} ID must equal canonical plugin ID "${canonicalId}"${source}`,
      )
    }
  }
  return canonicalId
}
