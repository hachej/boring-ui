import { createHash } from 'node:crypto'
import type { JsonValue } from '../../shared/index'

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Readonly<Record<string, JsonValue>>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key]!)}`).join(',')}}`
}

export function canonicalDigest(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}
