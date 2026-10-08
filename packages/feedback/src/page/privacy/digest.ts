// The page digest: SHA-256 (hex) of the snapshot's canonical JSON, through the platform module so it works on insecure origins too.
import { sha256 } from '@hachej/boring-files/platform';
import type { AppDomSnapshot } from './serialize.js';

/** JSON with object keys sorted at every level and no whitespace. Only JSON values (no `undefined`, functions or cycles) are accepted. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Non-finite number in canonical JSON'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new TypeError(`Not a JSON value: ${typeof value}`);
}

/** Lower-case hex SHA-256 of `canonicalJson(snapshot)`. */
export async function pageDigest(snapshot: AppDomSnapshot): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(canonicalJson(snapshot)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
