import { createHash } from 'node:crypto'
import type { JsonValue } from '../../shared/index'

/** Strict RFC-8259 JSON serialization with deterministic object-key ordering. */
export function canonicalJson(value: JsonValue): string {
  return serializeCanonical(value, new WeakSet<object>())
}

function serializeCanonical(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers')
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new TypeError('canonical JSON rejects non-JSON values')
  if (ancestors.has(value)) throw new TypeError('canonical JSON rejects cyclic values')

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError('canonical JSON rejects arrays with exotic prototypes')
      }
      const keys = Reflect.ownKeys(value)
      if (keys.some((key) => typeof key === 'symbol')) throw new TypeError('canonical JSON rejects symbol properties')
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError('canonical JSON rejects sparse arrays')
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !('value' in descriptor)) throw new TypeError('canonical JSON rejects accessor properties')
      }
      if (keys.some((key) => typeof key !== 'string' || (key !== 'length' && !isArrayIndex(key, value.length)))) {
        throw new TypeError('canonical JSON rejects non-index array properties')
      }
      return `[${value.map((item) => serializeCanonical(item, ancestors)).join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('canonical JSON rejects objects with exotic prototypes')
    }
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key === 'symbol')) throw new TypeError('canonical JSON rejects symbol properties')
    const stringKeys = keys as string[]
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('canonical JSON rejects accessor or non-enumerable properties')
      }
    }
    return `{${stringKeys.sort().map((key) => {
      const item = (value as Record<string, unknown>)[key]
      return `${JSON.stringify(key)}:${serializeCanonical(item, ancestors)}`
    }).join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key
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
