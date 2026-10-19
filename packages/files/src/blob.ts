/**
 * Large files as blob pointers. A large or binary file (up to 100 MB) lives in the host's blob store as an immutable blob, and the
 * workspace holds a small pointer file in its place (`<name>.blob.json`, media type `application/vnd.boring.blob+json`):
 *
 *   { "boring:blob": 1, "id": "<id>", "sha256": "<hex>", "size": <bytes>, "type": "<media type>", "name": "<file name>" }
 *
 * Where bytes live is the provider's business: the pointer is the provider's representation of a large immutable blob, written and
 * read through the workspace's one provider like any other file. The host serves the bytes at `GET <blobBase><encodeURIComponent(id)>`
 * (same origin, access checked on every request). This module reads pointers and names that URL; it never fetches. Pure: no Node, no DOM.
 */
import type { BlobItem, FilePage, RevisionProvider, UnsupportedBlobPointer } from './revision-contracts.js';

export type { BlobItem, UnsupportedBlobPointer } from './revision-contracts.js';

/** The pointer file's media type. */
export const BLOB_POINTER_MEDIA_TYPE = 'application/vnd.boring.blob+json';
/** The pointer format this module reads (`"boring:blob": 1`). A higher number is a newer format: `parseBlobPointer` says so. */
export const BLOB_POINTER_VERSION = 1;
/** A pointer file is small: anything this size or larger is not one. */
export const BLOB_POINTER_MAX_BYTES = 4096;
/** The ending of a pointer file's name in the workspace (`photos/cat.heic.blob.json`). */
export const BLOB_POINTER_SUFFIX = '.blob.json';
/** Where the host serves blob bytes by default: `GET /_files/<encodeURIComponent(id)>`. */
export const DEFAULT_BLOB_BASE = '/_files/';

/** A valid pointer, exactly the fields of the format. */
export interface BlobPointer {
  readonly 'boring:blob': 1;
  readonly id: string;
  /** Lower-case hex SHA-256 of the blob's bytes. */
  readonly sha256: string;
  /** The blob's size in bytes. */
  readonly size: number;
  /** The blob's media type. */
  readonly type: string;
  /** The file name shown for it (no path separators). */
  readonly name: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL.test(value);

/**
 * Reads a pointer file's bytes (or text), strictly: input under `BLOB_POINTER_MAX_BYTES`, UTF-8 JSON, every field present with its
 * type, `sha256` 64 lower-case hex digits, `size` a non-negative safe integer, `type` a media type, `name` a file name without path
 * separators. Returns the pointer; `{ kind: 'unsupported-version' }` for a higher `boring:blob`; `undefined` for anything else.
 */
export function parseBlobPointer(input: Uint8Array | string): BlobPointer | UnsupportedBlobPointer | undefined {
  if (typeof input === 'string' ? input.length >= BLOB_POINTER_MAX_BYTES || new TextEncoder().encode(input).byteLength >= BLOB_POINTER_MAX_BYTES : input.byteLength >= BLOB_POINTER_MAX_BYTES) return undefined;
  let value: unknown;
  try { value = JSON.parse(typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input)); } catch { return undefined; }
  if (!isRecord(value)) return undefined;
  const version = value['boring:blob'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return undefined;
  if (version > BLOB_POINTER_VERSION) return { kind: 'unsupported-version', version };
  const { id, sha256, size, type, name } = value;
  if (!text(id, 512) || typeof sha256 !== 'string' || !SHA256.test(sha256) || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0
    || typeof type !== 'string' || !MEDIA_TYPE.test(type) || !text(name, 255) || /[/\\]/.test(name) || name === '.' || name === '..') return undefined;
  return { 'boring:blob': 1, id, sha256, size, type, name };
}

/** Whether a workspace path names a pointer file (`*.blob.json`). */
export const isBlobPointerPath = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return name.length > BLOB_POINTER_SUFFIX.length && name.endsWith(BLOB_POINTER_SUFFIX);
};

/**
 * The checked blob base: a same-origin path starting with one `/` (default `/_files/`). A URL with a scheme or host, a
 * protocol-relative `//host`, a backslash, whitespace or a control character is refused with a `TypeError`.
 */
export function checkBlobBase(base: string = DEFAULT_BLOB_BASE): string {
  const origin = 'https://same-origin.invalid';
  let resolved: URL | undefined;
  try { resolved = new URL(base, origin); } catch { resolved = undefined; }
  if (typeof base !== 'string' || !base.startsWith('/') || base.startsWith('//') || /[\\\s]/.test(base) || CONTROL.test(base) || resolved?.origin !== origin) {
    throw new TypeError(`blobBase must be a same-origin path starting with "/", not ${JSON.stringify(base)}`);
  }
  return base;
}

/** The item a pointer stands for, with the URL of its bytes under a checked `base`. */
export const blobItemOf = (pointer: BlobPointer, base: string = DEFAULT_BLOB_BASE): BlobItem =>
  ({ name: pointer.name, size: pointer.size, type: pointer.type, url: `${checkBlobBase(base)}${encodeURIComponent(pointer.id)}` });

/** A pointer file's bytes as what to show: `{ kind: 'blob', item }`, an unsupported version, or `undefined` (not a pointer: show the file). */
export function resolveBlobPointer(input: Uint8Array | string, base: string = DEFAULT_BLOB_BASE): { readonly kind: 'blob'; readonly item: BlobItem } | UnsupportedBlobPointer | undefined {
  const parsed = parseBlobPointer(input);
  if (parsed === undefined || 'kind' in parsed) return parsed;
  return { kind: 'blob', item: blobItemOf(parsed, base) };
}

/**
 * The provider as a listing reads it: each pointer file in a `list` or `search` page carries `blob` (the item it stands for, or its
 * unsupported version), read once through the same provider. Every other call is the provider's own; reads still return the
 * pointer's bytes, so a conditional write of the pointer file works as for any file. `base` is checked here, once.
 */
export function withBlobPointers(provider: RevisionProvider, base: string = DEFAULT_BLOB_BASE): RevisionProvider {
  checkBlobBase(base);
  const resolve = async (page: FilePage, signal: AbortSignal | undefined): Promise<FilePage> => ({ ...page, entries: await Promise.all(page.entries.map(async entry => {
    if (entry.kind !== 'file' || !isBlobPointerPath(entry.path) || entry.size >= BLOB_POINTER_MAX_BYTES) return entry;
    try {
      const read = await provider.read({ target: provider.locate(entry.path), revision: { kind: 'latest' } }, signal);
      const resolved = read.kind === 'available' ? resolveBlobPointer(read.snapshot.bytes, base) : undefined;
      return resolved === undefined ? entry : { ...entry, blob: resolved.kind === 'blob' ? resolved.item : resolved };
    } catch (error) {
      if (signal?.aborted) throw error;
      return entry;
    }
  })) });
  return { ...provider, list: async (request, signal) => resolve(await provider.list(request, signal), signal), search: async (request, signal) => resolve(await provider.search(request, signal), signal) };
}
