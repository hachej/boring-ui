// Canonical SHA-256 digest primitives shared across agent-definition,
// agent-deployment resolution, and MCP artifact digests (audit finding #7:
// a duplicated inline sha256 in managedAgentDelegate.ts, and a resolvedDigest
// computation that skipped canonicalization entirely — see finding #1).
//
// Web Crypto (globalThis.crypto.subtle) only — no node:* built-ins, so this
// is safe to import from src/server/** and src/shared/** alike.

export type Sha256Digest = `sha256:${string}`

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function digestBytes(bytes: Uint8Array): Promise<Sha256Digest> {
  // Re-materialize into a plain ArrayBuffer-backed view: callers may hand us
  // a Uint8Array<ArrayBufferLike> (e.g. from Workspace.readBinaryFile), and
  // SubtleCrypto.digest only accepts an ArrayBuffer-backed BufferSource.
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return `sha256:${toHex(new Uint8Array(hash))}`
}

/** Hashes UTF-8 encoded text. */
export async function sha256(value: string): Promise<Sha256Digest> {
  return digestBytes(new TextEncoder().encode(value))
}

/** Hashes raw bytes. */
export async function sha256Bytes(bytes: Uint8Array): Promise<Sha256Digest> {
  return digestBytes(bytes)
}

/**
 * Deterministic JSON stringification: object keys sorted recursively,
 * `undefined` object values omitted, arrays preserve order. Used as the
 * canonicalization step before {@link sha256} wherever a digest must be
 * independent of source key/insertion order.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError('Cannot canonicalize undefined')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
    .join(',')}}`
}
