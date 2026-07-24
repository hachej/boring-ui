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

export function extractDefinePluginId(source: string, expectedId?: string): string | undefined {
  // Bundled entries may contain auxiliary plugins and renamed imports such as
  // definePlugin2. Resolve every call's leading id, then select the package's
  // canonical ID when supplied. Never scan through one object into a later id.
  const ids: string[] = []
  const calls = source.matchAll(/definePlugin\d*\s*\(\s*\{[^}]{0,2000}?\bid\s*:\s*([^,\n}]+)/g)
  for (const call of calls) {
    const expression = call[1]?.trim()
    if (!expression) continue
    const literal = expression.match(/^(["'`])([^"'`]+)\1$/)
    if (literal?.[2]) {
      ids.push(literal[2])
      continue
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(expression)) continue
    const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const declaration = source.match(new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=\\s*(["'])([^"']+)\\1`))
    if (declaration?.[2]) ids.push(declaration[2])
  }
  if (expectedId) return ids.includes(expectedId) ? expectedId : ids[0]
  return ids.length === 1 ? ids[0] : undefined
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
