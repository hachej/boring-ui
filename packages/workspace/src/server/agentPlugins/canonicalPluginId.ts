import { parse } from '@babel/parser'
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

function invalidFrontId(message: string): never {
  throw new CanonicalPluginIdError(`definePlugin ID ${message}`)
}

/**
 * Reads the canonical ID only from a direct default export. A declared front
 * entry is executable code, so unresolved or indirect shapes must fail closed
 * rather than being treated like a package with no front entry.
 */
export function extractDefinePluginId(source: string): string {
  let program: ReturnType<typeof parse>["program"]
  try {
    program = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    }).program
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ""
    return invalidFrontId(`cannot be parsed from the declared front entry${detail}`)
  }

  const defaultExports = program.body.filter((statement) => statement.type === "ExportDefaultDeclaration")
  if (defaultExports.length !== 1) {
    return invalidFrontId("requires exactly one default export in the declared front entry")
  }

  const declaration = defaultExports[0].declaration
  if (
    declaration.type !== "CallExpression"
    || declaration.callee.type !== "Identifier"
    || declaration.callee.name !== "definePlugin"
    || declaration.arguments.length !== 1
  ) {
    return invalidFrontId("must use a direct default export of definePlugin({ id: <literal> })")
  }

  const argument = declaration.arguments[0]
  if (argument.type !== "ObjectExpression") {
    return invalidFrontId("must use a direct object literal")
  }
  if (argument.properties.some((property) => property.type === "SpreadElement" || property.computed)) {
    return invalidFrontId("must not use spreads or computed properties")
  }

  const idProperties = argument.properties.filter((property) => {
    if (property.type !== "ObjectProperty" && property.type !== "ObjectMethod") return false
    return (property.key.type === "Identifier" && property.key.name === "id")
      || (property.key.type === "StringLiteral" && property.key.value === "id")
  })
  if (idProperties.length !== 1 || idProperties[0].type !== "ObjectProperty") {
    return invalidFrontId("must contain exactly one non-method id property")
  }

  const value = idProperties[0].value
  if (value.type === "StringLiteral") return value.value
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? value.quasis[0]?.value.raw ?? ""
  }
  return invalidFrontId("must be a string literal")
}

/**
 * App-side preflight join-key validation. It runs before contribution
 * collection; the Agent Host receives only this validated canonical ID.
 */
export function assertCanonicalPluginId(input: CanonicalPluginIdInput): string {
  const packageName = typeof input.packageJson.name === 'string'
    ? input.packageJson.name.trim().replace(/^@/, '').replaceAll('/', '-')
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
