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

type AstNode = { type: string; [key: string]: unknown }

interface Binding {
  readonly kind: "function" | "import" | "variable"
  readonly node: AstNode
  readonly statementIndex: number
  readonly init?: AstNode
  readonly importedName?: string
  readonly importSource?: string
}

interface Write {
  readonly node: AstNode
}

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"
}

function identifierName(node: unknown): string | undefined {
  return isNode(node) && node.type === "Identifier" && typeof node.name === "string" ? node.name : undefined
}

function exportedName(node: unknown): string | undefined {
  if (!isNode(node)) return undefined
  if (node.type === "Identifier" && typeof node.name === "string") return node.name
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value
  return undefined
}

function assignedNames(node: unknown): string[] {
  if (!isNode(node)) return []
  const name = identifierName(node)
  if (name) return [name]
  if (node.type === "RestElement") return assignedNames(node.argument)
  if (node.type === "AssignmentPattern") return assignedNames(node.left)
  if (node.type === "ArrayPattern") {
    return Array.isArray(node.elements) ? node.elements.flatMap(assignedNames) : []
  }
  if (node.type === "ObjectPattern") {
    if (!Array.isArray(node.properties)) return []
    return node.properties.flatMap((property) => {
      if (!isNode(property)) return []
      return property.type === "RestElement" ? assignedNames(property.argument) : assignedNames(property.value)
    })
  }
  return []
}

function unwrapExpression(node: AstNode): AstNode {
  if (
    node.type === "ParenthesizedExpression"
    || node.type === "TSAsExpression"
    || node.type === "TSSatisfiesExpression"
    || node.type === "TSTypeAssertion"
    || node.type === "TypeCastExpression"
  ) {
    return isNode(node.expression) ? unwrapExpression(node.expression) : node
  }
  return node
}

class StaticFrontIdResolver {
  private readonly body: AstNode[]
  private readonly bindings = new Map<string, Binding[]>()
  private readonly writes = new Map<string, Write[]>()
  private readonly parents = new WeakMap<AstNode, AstNode>()

  constructor(private readonly program: AstNode) {
    this.body = Array.isArray(program.body) ? program.body.filter(isNode) : []
    this.collectBindings()
    this.visit(program)
  }

  resolve(): string {
    const defaults: Array<{ expression: AstNode; statementIndex: number }> = []
    for (const [statementIndex, statement] of this.body.entries()) {
      if (statement.type === "ExportDefaultDeclaration" && isNode(statement.declaration)) {
        defaults.push({ expression: statement.declaration, statementIndex })
        continue
      }
      if (statement.type !== "ExportNamedDeclaration") continue
      if (statement.source !== null && statement.source !== undefined) continue
      const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers.filter(isNode) : []
      for (const specifier of specifiers) {
        if (specifier.type !== "ExportSpecifier" || exportedName(specifier.exported) !== "default") continue
        if (!isNode(specifier.local)) {
          return invalidFrontId("has an unresolved default export")
        }
        defaults.push({ expression: specifier.local, statementIndex })
      }
    }
    if (defaults.length !== 1) {
      return invalidFrontId("requires exactly one default export in the declared front entry")
    }
    return this.resolvePluginExpression(defaults[0].expression, defaults[0].statementIndex, new Set())
  }

  private collectBindings(): void {
    const add = (name: string | undefined, binding: Binding) => {
      if (!name) return
      const existing = this.bindings.get(name) ?? []
      existing.push(binding)
      this.bindings.set(name, existing)
    }
    for (const [statementIndex, originalStatement] of this.body.entries()) {
      const statement = originalStatement.type === "ExportNamedDeclaration" && isNode(originalStatement.declaration)
        ? originalStatement.declaration
        : originalStatement
      if (statement.type === "ImportDeclaration") {
        const source = isNode(statement.source) && statement.source.type === "StringLiteral"
          && typeof statement.source.value === "string" ? statement.source.value : undefined
        const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers.filter(isNode) : []
        for (const specifier of specifiers) {
          if (specifier.type !== "ImportSpecifier") continue
          add(identifierName(specifier.local), {
            kind: "import",
            node: specifier,
            statementIndex,
            importedName: exportedName(specifier.imported),
            importSource: source,
          })
        }
        continue
      }
      if (statement.type === "FunctionDeclaration") {
        add(identifierName(statement.id), { kind: "function", node: statement, statementIndex })
        continue
      }
      if (statement.type !== "VariableDeclaration") continue
      const declarations = Array.isArray(statement.declarations) ? statement.declarations.filter(isNode) : []
      for (const declaration of declarations) {
        if (declaration.type !== "VariableDeclarator") continue
        add(identifierName(declaration.id), {
          kind: "variable",
          node: declaration,
          statementIndex,
          ...(isNode(declaration.init) ? { init: declaration.init } : {}),
        })
      }
    }
  }

  private visit(node: AstNode, parent?: AstNode): void {
    if (parent) this.parents.set(node, parent)
    if (node.type === "AssignmentExpression") {
      for (const name of assignedNames(node.left)) this.addWrite(name, node)
    } else if (node.type === "UpdateExpression") {
      for (const name of assignedNames(node.argument)) this.addWrite(name, node)
    } else if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      for (const name of assignedNames(node.left)) this.addWrite(name, node)
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue
      if (isNode(value)) {
        this.visit(value, node)
      } else if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) this.visit(item, node)
      }
    }
  }

  private addWrite(name: string, node: AstNode): void {
    const existing = this.writes.get(name) ?? []
    existing.push({ node })
    this.writes.set(name, existing)
  }

  private uniqueBinding(name: string): Binding {
    const bindings = this.bindings.get(name) ?? []
    if (bindings.length !== 1) {
      return invalidFrontId(`must resolve "${name}" to exactly one local binding`)
    }
    return bindings[0]
  }

  private assertUnmodified(name: string): void {
    if ((this.writes.get(name) ?? []).length > 0) {
      return invalidFrontId(`must not use a mutated or reassigned binding "${name}"`)
    }
  }

  private resolvePluginExpression(
    originalExpression: AstNode,
    statementIndex: number,
    seen: Set<string>,
  ): string {
    const expression = unwrapExpression(originalExpression)
    const name = identifierName(expression)
    if (name) {
      if (seen.has(`plugin:${name}`)) return invalidFrontId("contains a cyclic plugin binding")
      const binding = this.uniqueBinding(name)
      if (binding.kind !== "variable" || !binding.init) {
        return invalidFrontId(`default export binding "${name}" must have a static initializer`)
      }
      this.assertUnmodified(name)
      const nextSeen = new Set(seen).add(`plugin:${name}`)
      return this.resolvePluginExpression(binding.init, binding.statementIndex, nextSeen)
    }
    if (expression.type !== "CallExpression") {
      return invalidFrontId("must resolve the default export to definePlugin({ id: <literal> })")
    }
    if (this.isDefinePluginCall(expression)) {
      return this.extractIdFromDefinePlugin(expression, statementIndex, seen)
    }
    return this.resolveFactoryCall(expression, statementIndex, seen)
  }

  private isDefinePluginCall(call: AstNode): boolean {
    const calleeName = identifierName(call.callee)
    if (!calleeName) return false
    const bindings = this.bindings.get(calleeName) ?? []
    if (bindings.length === 0) return calleeName === "definePlugin"
    if (bindings.length !== 1) return false
    const binding = bindings[0]
    return binding.kind === "import"
      && binding.importedName === "definePlugin"
      && binding.importSource === "@hachej/boring-workspace/plugin"
      && (this.writes.get(calleeName) ?? []).length === 0
  }

  private resolveFactoryCall(call: AstNode, statementIndex: number, seen: Set<string>): string {
    const calleeName = identifierName(call.callee)
    const args = Array.isArray(call.arguments) ? call.arguments : []
    if (!calleeName || args.length !== 0) {
      return invalidFrontId("must use definePlugin directly or a static zero-argument factory")
    }
    if (seen.has(`factory:${calleeName}`)) return invalidFrontId("contains a cyclic plugin factory")
    const binding = this.uniqueBinding(calleeName)
    if (binding.kind !== "function") {
      return invalidFrontId(`factory "${calleeName}" must be one local function declaration`)
    }
    this.assertUnmodified(calleeName)
    const body = isNode(binding.node.body) && Array.isArray(binding.node.body.body)
      ? binding.node.body.body.filter(isNode)
      : []
    if (binding.node.async === true || binding.node.generator === true || body.length !== 1 || body[0].type !== "ReturnStatement") {
      return invalidFrontId(`factory "${calleeName}" must contain one direct return`)
    }
    if (!isNode(body[0].argument)) return invalidFrontId(`factory "${calleeName}" must return definePlugin`)
    return this.resolvePluginExpression(body[0].argument, statementIndex, new Set(seen).add(`factory:${calleeName}`))
  }

  private extractIdFromDefinePlugin(call: AstNode, statementIndex: number, seen: Set<string>): string {
    const args = Array.isArray(call.arguments) ? call.arguments.filter(isNode) : []
    if (args.length !== 1 || args[0].type !== "ObjectExpression") {
      return invalidFrontId("must use a direct object literal")
    }
    const properties = Array.isArray(args[0].properties) ? args[0].properties.filter(isNode) : []
    if (properties.length !== (Array.isArray(args[0].properties) ? args[0].properties.length : 0)
      || properties.some((property) => property.type === "SpreadElement" || property.computed === true)) {
      return invalidFrontId("must not use spreads or computed properties")
    }
    const idProperties = properties.filter((property) => {
      if (property.type !== "ObjectProperty" && property.type !== "ObjectMethod") return false
      return (identifierName(property.key) === "id")
        || (isNode(property.key) && property.key.type === "StringLiteral" && property.key.value === "id")
    })
    if (idProperties.length !== 1 || idProperties[0].type !== "ObjectProperty" || !isNode(idProperties[0].value)) {
      return invalidFrontId("must contain exactly one non-method id property")
    }
    return this.resolveStringExpression(idProperties[0].value, statementIndex, seen)
  }

  private resolveStringExpression(originalExpression: AstNode, statementIndex: number, seen: Set<string>): string {
    const expression = unwrapExpression(originalExpression)
    if (expression.type === "StringLiteral" && typeof expression.value === "string") return expression.value
    if (expression.type === "TemplateLiteral") {
      const expressions = Array.isArray(expression.expressions) ? expression.expressions : []
      const quasis = Array.isArray(expression.quasis) ? expression.quasis.filter(isNode) : []
      if (expressions.length === 0 && quasis.length === 1
        && typeof quasis[0].value === "object" && quasis[0].value !== null) {
        const { cooked, raw } = quasis[0].value as { cooked?: unknown; raw?: unknown }
        if (typeof cooked === "string") return cooked
        if (typeof raw === "string") return raw
      }
      return invalidFrontId("must be a string literal")
    }
    const name = identifierName(expression)
    if (!name) return invalidFrontId("must be a string literal")
    if (seen.has(`string:${name}`)) return invalidFrontId("contains a cyclic ID binding")
    const binding = this.uniqueBinding(name)
    if (binding.kind !== "variable") return invalidFrontId(`ID binding "${name}" must be a local variable`)
    const nextSeen = new Set(seen).add(`string:${name}`)
    if (binding.init) {
      this.assertUnmodified(name)
      return this.resolveStringExpression(binding.init, binding.statementIndex, nextSeen)
    }
    return this.resolveTsupInitializedString(name, binding, statementIndex, nextSeen)
  }

  private resolveTsupInitializedString(
    name: string,
    binding: Binding,
    statementIndex: number,
    seen: Set<string>,
  ): string {
    const writes = this.writes.get(name) ?? []
    if (writes.length !== 1) {
      return invalidFrontId(`must not use a mutated or ambiguously initialized binding "${name}"`)
    }
    const assignment = writes[0].node
    if (assignment.operator !== "=" || !isNode(assignment.right)) {
      return invalidFrontId(`binding "${name}" must have one literal initialization`)
    }
    const expressionStatement = this.parents.get(assignment)
    const block = expressionStatement && this.parents.get(expressionStatement)
    const method = block && this.parents.get(block)
    const object = method && this.parents.get(method)
    const esmCall = object && this.parents.get(object)
    const declarator = esmCall && this.parents.get(esmCall)
    const declaration = declarator && this.parents.get(declarator)
    const initializerProperties = object?.type === "ObjectExpression" && Array.isArray(object.properties)
      ? object.properties.filter(isNode)
      : []
    if (
      expressionStatement?.type !== "ExpressionStatement"
      || block?.type !== "BlockStatement"
      || method?.type !== "ObjectMethod"
      || method.computed === true
      || object?.type !== "ObjectExpression"
      || initializerProperties.length !== 1
      || initializerProperties[0] !== method
      || esmCall?.type !== "CallExpression"
      || identifierName(esmCall.callee) !== "__esm"
      || !Array.isArray(esmCall.arguments)
      || esmCall.arguments.length !== 1
      || esmCall.arguments[0] !== object
      || declarator?.type !== "VariableDeclarator"
      || declarator.init !== esmCall
      || declaration?.type !== "VariableDeclaration"
      || this.parents.get(declaration) !== this.program
    ) {
      return invalidFrontId(`binding "${name}" must have an immutable local initializer`)
    }
    const initializerName = identifierName(declarator.id)
    if (!initializerName) return invalidFrontId(`binding "${name}" has an unresolved tsup initializer`)
    const initializerBinding = this.uniqueBinding(initializerName)
    if (initializerBinding.node !== declarator || !initializerBinding.init) {
      return invalidFrontId(`binding "${name}" has an ambiguous tsup initializer`)
    }
    this.assertUnmodified(initializerName)
    const esmBinding = this.uniqueBinding("__esm")
    if (esmBinding.kind !== "variable" || esmBinding.init?.type !== "ArrowFunctionExpression") {
      return invalidFrontId(`binding "${name}" has an untrusted tsup initializer`)
    }
    this.assertUnmodified("__esm")
    const initializedBeforeUse = this.body.some((statement, index) => {
      if (index >= statementIndex || statement.type !== "ExpressionStatement" || !isNode(statement.expression)) return false
      const call = statement.expression
      return call.type === "CallExpression"
        && identifierName(call.callee) === initializerName
        && Array.isArray(call.arguments)
        && call.arguments.length === 0
    })
    if (!initializedBeforeUse) {
      return invalidFrontId(`binding "${name}" is not initialized before definePlugin`)
    }
    return this.resolveStringExpression(assignment.right, binding.statementIndex, seen)
  }
}

/**
 * Reads the canonical ID from the unique default export without executing the
 * front entry. Direct source exports and the static identifier/specifier forms
 * emitted by tsup are supported; unresolved or mutable shapes fail closed.
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
  return new StaticFrontIdResolver(program as unknown as AstNode).resolve()
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
