import { createHash } from 'node:crypto'
import type { JsonValue } from '../../shared/index'

/** Strict RFC-8259 JSON serialization with deterministic object-key ordering. */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('canonical JSON rejects non-JSON values')
  const object = value as Readonly<Record<string, JsonValue>>
  return `{${Object.keys(object).sort().map((key) => {
    const item = object[key]
    if (item === undefined) throw new TypeError('canonical JSON rejects undefined values')
    return `${JSON.stringify(key)}:${canonicalJson(item)}`
  }).join(',')}}`
}

export function canonicalDigest(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/** Canonicalize, clone, and deeply freeze request material at a storage boundary. */
export function canonicalJsonValue(value: JsonValue): JsonValue {
  return deepFreeze(JSON.parse(canonicalJson(value)) as JsonValue)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
