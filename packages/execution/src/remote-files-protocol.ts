import { z } from 'zod';
import { FileError, ok, err } from '@earendil-works/pi-durable/env';
import type { FileInfo, FileSystem, Result, WatchChange, WatchTarget } from '@earendil-works/pi-durable/env';
import type { Context } from '@earendil-works/chord';
import { identity, nativeVersion } from './remote-shell-protocol.js';
export { identity, sameIdentity, positiveLimit, nativeVersion } from './remote-shell-protocol.js';

export const schema = 'boring.remote-files';
export const version = 3;
export const streamType = 'application/x-ndjson';
/**
 * Native methods sent over the wire unchanged. Pi's stateful readers (`openBinaryReader`, `openDirReader`) hold an open handle; a
 * stateless request cannot, so they travel as the request-bound methods of `PositionalCall`, and `watch` as one streamed request.
 */
export type FileMethod = Exclude<keyof FileSystem, 'id' | 'cwd' | 'cleanup' | 'openBinaryReader' | 'openDirReader' | 'watch'>;
type Arguments<Method> = Method extends (...args: [...infer Input, Context]) => unknown ? Input : never;
type NativeCall = { [Method in FileMethod]: { readonly method: Method; readonly args: Arguments<FileSystem[Method]> } }[FileMethod];
/** What a file looked like when the client opened it. A positional request fails when the file no longer matches (`FileInfo` has no inode). */
export interface ExpectedFile { readonly size: number; readonly mtimeMs: number }
export interface ReaderOptions { readonly noFollow?: boolean }
export interface DirPage { readonly entries: FileInfo[]; readonly done: boolean; readonly mtimeMs: number }
/** Each call opens the native reader, answers one bounded request and closes it, so no reader outlives a request. */
export type PositionalCall =
  | { readonly method: 'binaryInfo'; readonly args: readonly [path: string, options: ReaderOptions | undefined] }
  | { readonly method: 'readRange'; readonly args: readonly [path: string, options: ReaderOptions | undefined, offset: number, length: number, expected: ExpectedFile | undefined] }
  | { readonly method: 'scanLines'; readonly args: readonly [path: string, options: ReaderOptions | undefined, lines: { readonly startLine: number; readonly endLine?: number }, expected: ExpectedFile | undefined] }
  /** `maxEntries` 0 only opens the directory (native open errors, `mtimeMs`); `offset` counts entries the native reader already returned. */
  | { readonly method: 'readDirPage'; readonly args: readonly [path: string, offset: number, maxEntries: number, expectedMtimeMs: number | undefined] };
export type WatchCall = { readonly method: 'watch'; readonly args: readonly [targets: readonly WatchTarget[]] };
export type RemoteFileSystemCall = NativeCall | PositionalCall | WatchCall;
/** Largest `readRange` the response limit can carry as canonical base64 inside its envelope. */
export function maxRangeBytes(maxResponseBytes: number): number { return Math.max(1, Math.floor((maxResponseBytes - 2048) / 4) * 3); }
export const maxDirPageEntries = 1000, maxWatchTargets = 64;

const text = z.string(), number = z.number().finite();
/** Bytes travel as canonical base64 text; JSON number arrays multiplied the size by three to four. */
export function encodeBytes(value: Uint8Array): string {
  let text = '';
  for (let index = 0; index < value.length; index += 0x8000) text += String.fromCharCode(...value.subarray(index, index + 0x8000));
  return btoa(text);
}
export function decodeBytes(value: string): Uint8Array {
  let text: string;
  try { text = atob(value); } catch { throw new TypeError('Invalid resource bytes'); }
  const result = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) result[index] = text.charCodeAt(index);
  if (encodeBytes(result) !== value) throw new TypeError('Invalid resource bytes');
  return result;
}
export const bytes = z.string().transform(decodeBytes);
const content = z.union([text, z.strictObject({ bytes }).transform(value => value.bytes)]);
const optionalText = text.nullable().transform(value => value ?? undefined);
const recursive = z.strictObject({ recursive: z.boolean().optional() }).nullable().transform(value => value === null ? undefined : value.recursive === undefined ? {} : { recursive: value.recursive });
const removeOptions = z.strictObject({ recursive: z.boolean().optional(), force: z.boolean().optional() }).nullable().transform(value => value === null ? undefined : ({ ...(value.recursive === undefined ? {} : { recursive: value.recursive }), ...(value.force === undefined ? {} : { force: value.force }) }));
const lineOptions = z.strictObject({ maxLines: number.optional() }).nullable().transform(value => value === null ? undefined : value.maxLines === undefined ? {} : { maxLines: value.maxLines });
const tempOptions = z.strictObject({ prefix: text.optional(), suffix: text.optional() }).nullable().transform(value => value === null ? undefined : ({ ...(value.prefix === undefined ? {} : { prefix: value.prefix }), ...(value.suffix === undefined ? {} : { suffix: value.suffix }) }));
const int = z.number().int().nonnegative();
const readerOptions = z.strictObject({ noFollow: z.boolean().optional() }).nullable().transform(value => value === null ? undefined : value.noFollow === undefined ? {} : { noFollow: value.noFollow });
const expectedFile = z.strictObject({ size: number.nonnegative(), mtimeMs: number }).nullable().transform(value => value ?? undefined);
const lineRange = z.strictObject({ startLine: int, endLine: int.optional() }).transform(value => value.endLine === undefined ? { startLine: value.startLine } : { startLine: value.startLine, endLine: value.endLine });
const watchTarget = z.strictObject({
  path: text, recursive: z.boolean().optional(),
  exclude: z.strictObject({ hidden: z.boolean().optional(), names: z.array(text).max(256).optional() }).optional(),
}).transform((value): WatchTarget => ({
  path: value.path, ...(value.recursive === undefined ? {} : { recursive: value.recursive }),
  ...(value.exclude === undefined ? {} : { exclude: { ...(value.exclude.hidden === undefined ? {} : { hidden: value.exclude.hidden }), ...(value.exclude.names === undefined ? {} : { names: value.exclude.names }) } }),
}));
const pathCall = <Method extends string>(method: Method) => z.strictObject({ method: z.literal(method), args: z.tuple([text]) });
const callSchema = z.discriminatedUnion('method', [
  pathCall('absolutePath'), pathCall('readTextFile'), pathCall('openTextLineReader'), pathCall('readBinaryFile'),
  pathCall('flushFile'), pathCall('fileInfo'), pathCall('listDir'), pathCall('canonicalPath'), pathCall('exists'),
  z.strictObject({ method: z.literal('joinPath'), args: z.tuple([z.array(text)]) }),
  z.strictObject({ method: z.literal('readTextLines'), args: z.tuple([text, lineOptions]) }),
  z.strictObject({ method: z.literal('writeFile'), args: z.tuple([text, content]) }),
  z.strictObject({ method: z.literal('appendFile'), args: z.tuple([text, content]) }),
  z.strictObject({ method: z.literal('truncateFile'), args: z.tuple([text, number]) }),
  z.strictObject({ method: z.literal('renameFile'), args: z.tuple([text, text]) }),
  z.strictObject({ method: z.literal('createDir'), args: z.tuple([text, recursive]) }),
  z.strictObject({ method: z.literal('remove'), args: z.tuple([text, removeOptions]) }),
  z.strictObject({ method: z.literal('createTempDir'), args: z.tuple([optionalText]) }),
  z.strictObject({ method: z.literal('createTempFile'), args: z.tuple([tempOptions]) }),
  z.strictObject({ method: z.literal('binaryInfo'), args: z.tuple([text, readerOptions]) }),
  z.strictObject({ method: z.literal('readRange'), args: z.tuple([text, readerOptions, int, int, expectedFile]) }),
  z.strictObject({ method: z.literal('scanLines'), args: z.tuple([text, readerOptions, lineRange, expectedFile]) }),
  z.strictObject({ method: z.literal('readDirPage'), args: z.tuple([text, int, int.max(maxDirPageEntries), z.number().finite().nullable().transform(value => value ?? undefined)]) }),
  z.strictObject({ method: z.literal('watch'), args: z.tuple([z.array(watchTarget).min(1).max(maxWatchTargets)]) }),
]);
const binding = { schema: z.literal(schema), version: z.literal(version), nativeVersion: z.literal(nativeVersion),
  requestId: text.min(1).max(128), identity: z.unknown().transform(identity), filesystemId: text.min(1) };
const requestSchema = z.strictObject({ ...binding, cwd: text, call: callSchema });
export function requestInput(value: unknown): Omit<z.infer<typeof requestSchema>, 'call'> & { readonly call: RemoteFileSystemCall } { return requestSchema.parse(value); }
export const envelope = z.strictObject({ ...binding, result: z.unknown() });
export const fileInfo = z.strictObject({ name: text, path: text, kind: z.enum(['file', 'directory', 'symlink']), size: number.nonnegative(), mtimeMs: number });
export const lineScan = z.strictObject({ newlines: int, start: int, end: int, firstLineEnd: int, lastLineStart: int, selectedBytes: int, firstLineBytes: int });
export const dirPage = z.strictObject({ entries: z.array(fileInfo), done: z.boolean(), mtimeMs: number });
export const line = z.strictObject({ text, terminated: z.boolean() });
export const nothing = z.null().transform(() => undefined);
const fileError = z.strictObject({ code: z.enum(['aborted', 'not_found', 'permission_denied', 'not_directory', 'is_directory', 'invalid', 'not_supported', 'unknown']), message: text, path: text.optional() });
export function result<Value>(value: unknown, output: z.ZodType<Value>): Result<Value, FileError> {
  const parsed = z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value: output }), z.strictObject({ ok: z.literal(false), error: fileError })]).parse(value);
  return parsed.ok ? ok(parsed.value) : err(new FileError(parsed.error.code, parsed.error.message, parsed.error.path));
}
export function wireResult(value: Result<unknown, FileError>): unknown {
  if (value.ok) return { ok: true, value: value.value instanceof Uint8Array ? encodeBytes(value.value) : value.value ?? null };
  return { ok: false, error: { code: value.error.code, message: value.error.message, ...(value.error.path === undefined ? {} : { path: value.error.path }) } };
}
const watchChange = z.union([
  z.strictObject({ paths: z.array(text) }),
  z.strictObject({ overflow: z.literal(true) }),
  z.strictObject({ error: fileError }).transform(value => ({ error: new FileError(value.error.code, value.error.message, value.error.path) })),
]);
export function parseWatchChange(value: unknown): WatchChange { return watchChange.parse(value) as WatchChange; }
export function wireWatchChange(change: WatchChange): unknown {
  if ('error' in change) return { error: { code: change.error.code, message: change.error.message, ...(change.error.path === undefined ? {} : { path: change.error.path }) } };
  return change;
}
export const streamFrame = z.discriminatedUnion('type', [
  z.strictObject({ ...binding, sequence: z.literal(0), type: z.literal('opened'), mode: z.enum(['native', 'polling']).optional() }),
  z.strictObject({ requestId: binding.requestId, sequence: z.number().int().positive(), type: z.literal('change'), change: z.unknown() }),
  z.strictObject({ requestId: binding.requestId, sequence: z.number().int().positive(), type: z.literal('line'), result: z.unknown() }),
  z.strictObject({ requestId: binding.requestId, sequence: z.number().int().positive(), type: z.literal('end') }),
]);
export function wireCall(call: RemoteFileSystemCall): unknown {
  // JSON has no Infinity; an unbounded line count is the same request as no limit.
  const unbounded = call.method === 'readTextLines' && call.args[1]?.maxLines === Infinity;
  return { method: call.method, args: call.args.map((value, index) => unbounded && index === 1 ? {} : value instanceof Uint8Array ? { bytes: encodeBytes(value) } : value ?? null) };
}
