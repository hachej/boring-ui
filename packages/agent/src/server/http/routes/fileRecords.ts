import { extname } from 'node:path/posix'

export const MAX_RECORD_FILE_BYTES = 2 * 1024 * 1024

const MAX_RECORD_ROWS_SCANNED = 10_000
const MAX_RECORD_ROWS_RETURNED = 100
const DEFAULT_RECORD_ROWS_RETURNED = 50
const MAX_RECORD_OUTPUT_BYTES = 512 * 1024
const MAX_RECORD_QUERY_LENGTH = 256
const MAX_RECORD_COLUMNS = 100
const MAX_RECORD_COLUMN_SAMPLE_ROWS = 100

export type FileRecordsFormat = 'json-array' | 'ndjson' | 'csv'

export type FileRecord = Record<string, unknown>

export interface FileRecordsRequest {
  path: string
  offset: number
  limit: number
  q: string | null
}

export interface FileRecordsResult {
  source: { kind: 'file'; path: string; format: FileRecordsFormat }
  path: string
  format: FileRecordsFormat
  columns: { name: string; type: string }[]
  rows: FileRecord[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
  mtimeMs?: number
}

export class FileRecordsValidationError extends Error {
  field?: string

  constructor(message: string, field?: string) {
    super(message)
    this.name = 'FileRecordsValidationError'
    this.field = field
  }
}

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

function requireStringQueryParam(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FileRecordsValidationError(`${field} is required`, field)
  }
  if (value.includes('\0')) {
    throw new FileRecordsValidationError('null bytes not allowed', field)
  }
  return value
}

function parseNonNegativeInteger(value: unknown, field: string, fallback: number, max = MAX_RECORD_ROWS_SCANNED): number {
  const raw = firstQueryValue(value)
  if (raw === undefined) return fallback
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(text)) {
    throw new FileRecordsValidationError(`${field} must be a non-negative integer`, field)
  }
  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new FileRecordsValidationError(`${field} is too large`, field)
  }
  return parsed
}

function parseLimit(value: unknown): number {
  const raw = firstQueryValue(value)
  if (raw === undefined) return DEFAULT_RECORD_ROWS_RETURNED
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new FileRecordsValidationError('limit must be a positive integer', 'limit')
  }
  return Math.min(Number(text), MAX_RECORD_ROWS_RETURNED)
}

export function parseFileRecordsRequest(query: Record<string, unknown>): FileRecordsRequest {
  const path = requireStringQueryParam(firstQueryValue(query.path), 'path')
  const recordSet = firstQueryValue(query.recordSet)
  if (recordSet !== undefined && String(recordSet).trim() !== '') {
    throw new FileRecordsValidationError('recordSet is not supported for file records in v1', 'recordSet')
  }
  const offset = parseNonNegativeInteger(query.offset, 'offset', 0)
  const limit = parseLimit(query.limit)
  const rawQ = firstQueryValue(query.q)
  const q = typeof rawQ === 'string' ? rawQ.trim() : rawQ === undefined ? '' : String(rawQ).trim()
  if (q.length > MAX_RECORD_QUERY_LENGTH) {
    throw new FileRecordsValidationError('q is too long', 'q')
  }
  return { path, offset, limit, q: q ? q.toLowerCase() : null }
}

function detectRecordsFormat(path: string, content: string): FileRecordsFormat | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.ndjson' || ext === '.jsonl') return 'ndjson'
  if (ext === '.csv') return 'csv'
  if (ext === '.json') return 'json-array'
  const trimmed = content.trimStart()
  if (trimmed.startsWith('[')) return 'json-array'
  if (trimmed.startsWith('{')) return 'ndjson'
  return null
}

function normalizeRecord(row: unknown): FileRecord {
  if (row && typeof row === 'object' && !Array.isArray(row)) return row as FileRecord
  return { value: row }
}

function scalarMatches(value: unknown, q: string): boolean {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return false
  return String(value).toLowerCase().includes(q)
}

function recordMatches(record: FileRecord, q: string | null): boolean {
  if (!q) return true
  return Object.values(record).some((value) => scalarMatches(value, q))
}

function inferValueType(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function inferColumns(rows: FileRecord[]): { name: string; type: string }[] {
  const typesByName = new Map<string, Set<string>>()
  for (const row of rows.slice(0, MAX_RECORD_COLUMN_SAMPLE_ROWS)) {
    for (const [name, value] of Object.entries(row)) {
      if (!typesByName.has(name)) {
        if (typesByName.size >= MAX_RECORD_COLUMNS) continue
        typesByName.set(name, new Set())
      }
      typesByName.get(name)?.add(inferValueType(value))
    }
  }
  return [...typesByName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, types]) => ({ name, type: types.size === 1 ? [...types][0] ?? 'unknown' : 'mixed' }))
}

function parseJsonArrayRecords(content: string): FileRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new FileRecordsValidationError('malformed JSON records file')
  }
  if (!Array.isArray(parsed)) throw new FileRecordsValidationError('JSON records file must contain an array')
  if (parsed.length > MAX_RECORD_ROWS_SCANNED) throw new FileRecordsValidationError('record scan limit exceeded')
  return parsed.map(normalizeRecord)
}

function parseNdjsonRecords(content: string): FileRecord[] {
  const rows: FileRecord[] = []
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (rows.length >= MAX_RECORD_ROWS_SCANNED) throw new FileRecordsValidationError('record scan limit exceeded')
    try {
      rows.push(normalizeRecord(JSON.parse(line)))
    } catch {
      throw new FileRecordsValidationError('malformed NDJSON records file')
    }
  }
  return rows
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]
    if (char === '"') {
      if (quoted && content[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === ',' && !quoted) {
      row.push(current)
      current = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[i + 1] === '\n') i += 1
      row.push(current)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      current = ''
      continue
    }
    current += char
  }
  if (quoted) throw new FileRecordsValidationError('malformed CSV records file')
  row.push(current)
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

function parseCsvRecords(content: string): FileRecord[] {
  const parsedRows = parseCsvRows(content)
  if (parsedRows.length === 0) return []
  const headers = (parsedRows[0] ?? []).map((header) => header.trim())
  if (headers.some((header) => !header)) throw new FileRecordsValidationError('CSV records file must have a non-empty header row')
  const rows: FileRecord[] = []
  for (const values of parsedRows.slice(1)) {
    if (rows.length >= MAX_RECORD_ROWS_SCANNED) throw new FileRecordsValidationError('record scan limit exceeded')
    const row: FileRecord = {}
    for (const [index, header] of headers.entries()) row[header] = values[index] ?? ''
    rows.push(row)
  }
  return rows
}

export function buildFileRecordsResult(args: {
  path: string
  content: string
  mtimeMs?: number
  offset: number
  limit: number
  q: string | null
}): FileRecordsResult {
  const format = detectRecordsFormat(args.path, args.content)
  if (!format) throw new FileRecordsValidationError('unsupported records file format')
  const allRows = format === 'json-array'
    ? parseJsonArrayRecords(args.content)
    : format === 'ndjson'
      ? parseNdjsonRecords(args.content)
      : parseCsvRecords(args.content)
  const matching = allRows.filter((row) => recordMatches(row, args.q))
  const rows = matching.slice(args.offset, args.offset + args.limit)
  const result: FileRecordsResult = {
    source: { kind: 'file', path: args.path, format },
    path: args.path,
    format,
    columns: inferColumns(matching),
    rows,
    total: matching.length,
    hasMore: args.offset + rows.length < matching.length,
    offset: args.offset,
    limit: args.limit,
    mtimeMs: args.mtimeMs,
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RECORD_OUTPUT_BYTES) {
    throw new FileRecordsValidationError('record output limit exceeded')
  }
  return result
}
