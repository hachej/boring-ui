export interface SqliteColumnSnapshot {
  readonly name: string
  readonly type: string
  readonly notnull: 0 | 1
  readonly dflt_value: string | null
  readonly pk: number
}

export interface SqliteIndexSnapshot {
  readonly name: string
  readonly sql: string | null
}

export interface SqliteTableSnapshot {
  readonly name: string
  readonly sql: string
  readonly columns: readonly SqliteColumnSnapshot[]
  readonly indexes: readonly SqliteIndexSnapshot[]
}

export interface SqliteSchemaSnapshot {
  readonly tables: readonly SqliteTableSnapshot[]
}

export type SafeAdditivePlan =
  | { readonly ok: true; readonly statements: readonly string[] }
  | { readonly ok: false; readonly reason: string }

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function normalizeType(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

function normalizeDefault(value: string | null): string | null {
  if (value === null) return null
  return value.trim().replace(/^\((.*)\)$/s, '$1').replace(/\s+/g, ' ').toUpperCase()
}

function sameColumn(current: SqliteColumnSnapshot, target: SqliteColumnSnapshot): boolean {
  return current.name === target.name
    && normalizeType(current.type) === normalizeType(target.type)
    && current.notnull === target.notnull
    && normalizeDefault(current.dflt_value) === normalizeDefault(target.dflt_value)
    && current.pk === target.pk
}

function splitSqlList(value: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote: '"' | "'" | '`' | ']' | null = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!
    if (quote) {
      if (quote === ']' && char === ']') quote = null
      else if (quote !== ']' && char === quote) {
        if (value[index + 1] === quote) index += 1
        else quote = null
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '[') quote = ']'
    else if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  const tail = value.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

function tableDefinitions(sql: string): string[] {
  const open = sql.indexOf('(')
  const close = sql.lastIndexOf(')')
  if (open < 0 || close <= open) return []
  return splitSqlList(sql.slice(open + 1, close))
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    return trimmed.slice(1, -1).replaceAll(trimmed[0]! + trimmed[0]!, trimmed[0]!)
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1)
  return trimmed
}

function definitionName(definition: string): string | undefined {
  const match = definition.match(/^\s*("(?:""|[^"])+"|`(?:``|[^`])+`|\[[^\]]+\]|[^\s]+)\s+/)
  if (!match) return undefined
  const name = unquoteIdentifier(match[1]!)
  if (/^(?:CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(name)) return undefined
  return name
}

function columnDefinition(table: SqliteTableSnapshot, columnName: string): string | undefined {
  return tableDefinitions(table.sql).find((definition) => definitionName(definition) === columnName)
}

function hasAddedConstraint(current: SqliteTableSnapshot, target: SqliteTableSnapshot): boolean {
  const constraint = /\b(?:CONSTRAINT|UNIQUE|CHECK|REFERENCES|FOREIGN\s+KEY)\b/i
  const currentDefinitions = tableDefinitions(current.sql)
  const targetDefinitions = tableDefinitions(target.sql)
  const currentByName = new Map(currentDefinitions.flatMap((definition) => {
    const name = definitionName(definition)
    return name ? [[name, definition] as const] : []
  }))
  for (const definition of targetDefinitions) {
    const name = definitionName(definition)
    if (!name) {
      if (constraint.test(definition) && !currentDefinitions.some((candidate) => candidate.replace(/\s+/g, ' ').trim() === definition.replace(/\s+/g, ' ').trim())) return true
      continue
    }
    if (!currentByName.has(name)) continue
    const before = currentByName.get(name)!
    if (constraint.test(definition) && !constraint.test(before)) return true
  }
  return false
}

function isSafeDefault(value: string | null): boolean {
  if (value === null) return false
  const normalized = value.trim().replace(/^\((.*)\)$/s, '$1').trim()
  return /^(?:[-+]?\d+(?:\.\d+)?|'(?:''|[^'])*'|"(?:""|[^"])*"|TRUE|FALSE)$/i.test(normalized)
}

function ensureStatement(statement: string): string {
  const trimmed = statement.trim().replace(/;+$/, '')
  return `${trimmed};`
}

/**
 * Compare the schema actually present in the live database with the schema
 * produced by the candidate on an empty database. The resulting statements
 * are the complete, exact allowlisted plan later applied to preview and Keep.
 */
export function planSafeAdditiveMigration(current: SqliteSchemaSnapshot, target: SqliteSchemaSnapshot): SafeAdditivePlan {
  const currentTables = new Map(current.tables.map((table) => [table.name, table]))
  const targetTables = new Map(target.tables.map((table) => [table.name, table]))
  const statements: string[] = []

  for (const [name, currentTable] of currentTables) {
    const targetTable = targetTables.get(name)
    if (!targetTable) return { ok: false, reason: `the candidate removes table ${name}` }
    if (hasAddedConstraint(currentTable, targetTable)) {
      return { ok: false, reason: `the candidate adds a constraint to existing table ${name}` }
    }

    const targetColumns = new Map(targetTable.columns.map((column) => [column.name, column]))
    for (const column of currentTable.columns) {
      const targetColumn = targetColumns.get(column.name)
      if (!targetColumn) return { ok: false, reason: `the candidate removes or renames ${name}.${column.name}` }
      if (!sameColumn(column, targetColumn)) return { ok: false, reason: `the candidate changes the type or constraints of ${name}.${column.name}` }
    }

    for (const column of targetTable.columns) {
      if (currentTable.columns.some((candidate) => candidate.name === column.name)) continue
      const definition = columnDefinition(targetTable, column.name)
      if (!definition) return { ok: false, reason: `the definition for new column ${name}.${column.name} could not be inspected` }
      if (/\b(?:PRIMARY\s+KEY|UNIQUE|CHECK|REFERENCES|CONSTRAINT|GENERATED)\b/i.test(definition)) {
        return { ok: false, reason: `new column ${name}.${column.name} adds a constraint to existing data` }
      }
      if (column.notnull === 1 && !isSafeDefault(column.dflt_value)) {
        return { ok: false, reason: `new required column ${name}.${column.name} has no safe constant default` }
      }
      statements.push(`ALTER TABLE ${quoteIdentifier(name)} ADD COLUMN ${definition.trim()};`)
    }

    const currentIndexes = new Map(currentTable.indexes.filter((index) => index.sql).map((index) => [index.name, index.sql!.replace(/\s+/g, ' ').trim()]))
    const targetIndexes = new Map(targetTable.indexes.filter((index) => index.sql).map((index) => [index.name, index.sql!.replace(/\s+/g, ' ').trim()]))
    if (currentIndexes.size !== targetIndexes.size || [...currentIndexes].some(([indexName, sql]) => targetIndexes.get(indexName) !== sql)) {
      return { ok: false, reason: `the candidate changes indexes on existing table ${name}` }
    }
  }

  for (const table of target.tables) {
    if (currentTables.has(table.name)) continue
    statements.push(ensureStatement(table.sql))
    for (const index of table.indexes) {
      if (index.sql) statements.push(ensureStatement(index.sql))
    }
  }

  const inspected = inspectSafeAdditiveSql(statements.join('\n'), new Set(currentTables.keys()))
  return inspected.ok ? { ok: true, statements } : inspected
}

/** Defense in depth for persisted/replayed plans. Only CREATE for new tables and
 * ALTER ADD COLUMN may reach a database containing user data. */
export function inspectSafeAdditiveSql(sql: string, existingTables: ReadonlySet<string> = new Set()): SafeAdditivePlan {
  const statements = splitSqlStatements(sql)
  for (const statement of statements) {
    if (/^(?:INSERT|UPDATE|DELETE|REPLACE|DROP|VACUUM|PRAGMA|ATTACH|DETACH)\b/i.test(statement)) {
      return { ok: false, reason: 'data rewrites, backfills, drops, and database-control statements are not allowed' }
    }
    if (/^ALTER\s+TABLE\b/i.test(statement)) {
      const match = statement.match(/^ALTER\s+TABLE\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([^\s]+))\s+ADD\s+(?:COLUMN\s+)?(.+)$/is)
      if (!match) return { ok: false, reason: 'only additive columns are allowed on existing tables' }
      const definition = match[5]!
      if (/\b(?:RENAME|DROP|ALTER|UNIQUE|CHECK|REFERENCES|CONSTRAINT|PRIMARY\s+KEY|GENERATED)\b/i.test(definition)) {
        return { ok: false, reason: 'renames, retypes, and constraints on existing data are not allowed' }
      }
      continue
    }
    const create = statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([^\s(]+))/i)
    if (create) {
      const name = create[1] ?? create[2] ?? create[3] ?? create[4]!
      if (existingTables.has(name)) return { ok: false, reason: `table rebuild of ${name} is not allowed` }
      continue
    }
    if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement)) continue
    return { ok: false, reason: `statement is outside the safe-additive allowlist: ${statement.slice(0, 80)}` }
  }
  return { ok: true, statements: statements.map(ensureStatement) }
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let start = 0
  let quote: '"' | "'" | '`' | null = null
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!
    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) index += 1
        else quote = null
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === ';') {
      const statement = sql.slice(start, index).trim()
      if (statement) statements.push(statement)
      start = index + 1
    }
  }
  const tail = sql.slice(start).trim()
  if (tail) statements.push(tail)
  return statements
}
