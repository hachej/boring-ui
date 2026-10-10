import { defineExtension, wrapTool } from '@earendil-works/pi-durable';
import type { ToolExecutionApi, ToolExecutionResult, ToolRegistration } from '@earendil-works/pi-durable';
import { createReadTool } from '@earendil-works/pi-durable/tools';
import type { Context } from '@earendil-works/chord';
import type { ResourceAccess } from '@hachej/boring-files';
import { workspaceRelative } from './file-guard.js';
import { SNIFF_BYTES, fileKind, mediaTypeFor } from './file-types.js';
import type { FileKind } from './file-types.js';
import { asWorkspaceResolver, workspaceFor } from './workspaces.js';
import type { WorkspaceBinding, WorkspaceResolver } from './workspaces.js';

/*
 * One `read`. This wraps Pi's native `read` (public `wrapTool`, the supported way to override a native tool) and adds no tool:
 *
 *  - Text goes to Pi's native read untouched.
 *  - A PDF, an office document or an image goes to the host's `convert` hook (`workersAiMarkdown` adapts Workers AI). The converted
 *    text is cached per path and saved revision and paged exactly as Pi pages a text file: `offset` is the 1-based line to start at,
 *    `limit` a count of lines, a page ends at 2000 lines or 50 KB, and the info diagnostic names the `offset` to continue from.
 *  - An archive or other binary file (a NUL byte) answers `unsupported` and is never converted. Without `convert`, an image goes to
 *    Pi's native behaviour and a PDF or office file answers `unsupported`.
 *
 * What is a text file and what is not comes from the single table in file-types.ts: the extension and the leading bytes (Pi's read
 * returns garbled text for a PDF, so the magic number decides, not only the name). The converted file is read through the workspace
 * provider, which checks access; a path this wrapper cannot place inside the workspace is left to the native read, and the file guard
 * (`createFileGuard`) refuses it. Install this extension before the guard, so the guard stays outermost. Nothing is written.
 */

const MAX_LINES = 2000;        // Pi's read page: DEFAULT_MAX_LINES
const MAX_BYTES = 50 * 1024;   // Pi's read page: DEFAULT_MAX_BYTES
const DEFAULT_MAX_FILE = 20 * 1024 * 1024;

/** The converter: bytes to text, or `{ error }`. A failure is not cached. */
export type FileConverter = (file: { readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }) => Promise<{ readonly text: string } | { readonly error: string }>;

/** Converted text per `<path>@<revision>`. A `Map<string, string>` satisfies it. */
export interface ConvertedTextCache {
  get(key: string): string | undefined | Promise<string | undefined>;
  set(key: string, text: string): unknown;
}

export interface ConvertingReadOptions {
  /** The workspace of each call, resolved like the file guard's (`@hachej/boring-agent/workspaces`); absent: the env's workspace. */
  readonly workspace?: WorkspaceResolver | WorkspaceBinding | undefined;
  /** The agent's principal for the provider. Default: the binding's `access`. */
  readonly resolveAccess?: (api: ToolExecutionApi, context: Context) => ResourceAccess | Promise<ResourceAccess>;
  /** Converts a file to text. Without it, images use Pi's native read and other binary files answer `unsupported`. */
  readonly convert?: FileConverter;
  /** Stores converted text per revision. Without it, each read converts again. */
  readonly cache?: ConvertedTextCache;
  /** Largest file converted, in bytes. Default 20 MiB. */
  readonly maxBytes?: number;
  /** The extension name (default `boring.files.read`). */
  readonly name?: string;
}

type ReadArgs = { readonly path: string; readonly offset?: number; readonly limit?: number };
type Execute = (args: ReadArgs, api: ToolExecutionApi, context: Context) => Promise<ToolExecutionResult>;

const failure = (text: string, code: string): ToolExecutionResult => ({ content: [{ type: 'text', text }], isError: true, diagnostics: [{ severity: 'error', code, message: text }] });
const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * The converted text as pageable lines. A line longer than MAX_BYTES is split, on character boundaries, into segments of at most
 * MAX_BYTES; each segment counts as one line for `offset` and `limit`, so every byte stays reachable with an honest offset (Pi's own
 * read can only point at `sed` for the rest of such a line, and converted text has no file for `sed`). `split` maps the 0-based
 * index of each segment to the 1-based number of the original line.
 */
function linesOf(text: string): { lines: string[]; split: Map<number, number> } {
  const lines: string[] = [], split = new Map<number, number>();
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  text.split('\n').forEach((line, index) => {
    if (utf8Length(line) <= MAX_BYTES) { lines.push(line); return; }
    const bytes = encoder.encode(line);
    for (let start = 0; start < bytes.length;) {
      let end = Math.min(bytes.length, start + MAX_BYTES);
      while (end < bytes.length && end > start && (bytes[end]! & 0xc0) === 0x80) end--; // never cut inside a character
      split.set(lines.length, index + 1);
      lines.push(decoder.decode(bytes.subarray(start, end)));
      start = end;
    }
  });
  return { lines, split };
}

/** The lines from the 0-based `start`, cut like Pi's `truncateHead`: whole lines up to MAX_LINES / MAX_BYTES (no line exceeds MAX_BYTES). */
function page(lines: readonly string[], start: number, count: number): { text: string; shown: number; byBytes: boolean } {
  const out: string[] = [];
  let bytes = 0, byBytes = false;
  for (let index = start; index < start + count && out.length < MAX_LINES; index++) {
    const line = lines[index]!;
    const size = utf8Length(line) + (out.length > 0 ? 1 : 0);
    if (bytes + size > MAX_BYTES) { byBytes = true; break; }
    bytes += size;
    out.push(line);
  }
  return { text: out.join('\n'), shown: out.length, byBytes };
}

type Diagnostic = { severity: 'info' | 'warn'; code?: string; message: string };

/** Pi's read result for already converted text. */
function convertedPage(text: string, offset: number | undefined, limit: number | undefined): ToolExecutionResult {
  const { lines, split } = linesOf(text);
  const total = lines.length;
  const start = offset ? Math.max(0, Math.trunc(offset) - 1) : 0;
  if (start >= total) throw new Error(`Offset ${offset} is beyond end of file (${total} lines total)`);
  const wanted = limit === undefined ? total - start : Math.max(1, Math.min(Math.trunc(limit), total - start));
  const { text: shownText, shown, byBytes } = page(lines, start, wanted);
  const end = start + shown;
  const diagnostics: Diagnostic[] = [];
  const cut = [...new Set([...split].filter(([index]) => index >= start && index < end).map(([, original]) => original))];
  if (cut.length) diagnostics.push({ severity: 'warn', code: 'truncated', message: `The converted text has ${cut.length === 1 ? 'a line' : 'lines'} longer than ${MAX_BYTES / 1024}KB (original line ${cut.join(', ')}); each is split into segments of at most ${MAX_BYTES / 1024}KB and every segment counts as one line for offset and limit.` });
  if (shown < wanted) diagnostics.push({ severity: 'info', code: 'truncated', message: `Showing lines ${start + 1}-${end} of ${total}${byBytes ? ` (${MAX_BYTES / 1024}KB limit)` : ''}. Use offset=${end + 1} to continue.` });
  else if (end < total) diagnostics.push({ severity: 'info', message: `${total - end} more lines in file. Use offset=${end + 1} to continue.` });
  return { content: shownText === '' ? [] : [{ type: 'text', text: shownText }], diagnostics };
}

/** Pi's `read`, extended to convert PDF, office and image files through the host's converter. An extension to select (after the extension that registers `read`, before the file guard). */
export function createConvertingRead(options: ConvertingReadOptions = {}) {
  const resolver = asWorkspaceResolver(options.workspace);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE;

  function converting<Tool extends ToolRegistration>(tool: Tool): Tool {
    const native = tool.execute as unknown as Execute;
    const execute: Execute = async (args, api, context) => {
      const resolved = await workspaceFor(resolver, api, context);
      if ('refused' in resolved) return native(args, api, context);
      const root = resolved.binding.root.replace(/\/+$/, '');
      const located = await workspaceRelative(api, root, args.path, context);
      if (located === undefined) return native(args, api, context);
      // The access check comes first, and the type is sniffed on the bytes the provider returned: nothing is read around it.
      const { files } = resolved.binding;
      const access = options.resolveAccess ? await options.resolveAccess(api, context) : resolved.binding.access;
      if (access === undefined) return failure('Refused: the host gave no access for this workspace.', 'denied');
      const read = await files.read({ target: { resource: { providerId: files.providerId, path: located.path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, { ...access });
      if (read.kind === 'missing') return native(args, api, context);
      if (read.kind !== 'available') return failure(`Refused: ${args.path} cannot be read here (${read.reason}).`, 'denied');
      const { snapshot } = read;
      const head = snapshot.bytes.subarray(0, SNIFF_BYTES);
      const kind: FileKind = fileKind(located.path, head);
      if (kind === 'text') return native(args, api, context);
      if (kind === 'archive' || kind === 'binary') return failure(`${args.path} is ${kind === 'archive' ? 'an archive' : 'a binary file'}; it cannot be read as text here (unsupported).`, 'unsupported');
      if (!options.convert) {
        if (kind === 'image') return native(args, api, context);
        return failure(`${args.path} is a ${kind} file; this agent has no converter, so it cannot be read as text here (unsupported).`, 'unsupported');
      }
      if (snapshot.bytes.byteLength > maxBytes) return failure(`${args.path} is larger than ${maxBytes} bytes and is not converted.`, 'too_large');
      const key = `${located.path}@${snapshot.ref.revision}`;
      let text = await options.cache?.get(key);
      if (text === undefined) {
        const result = await options.convert({ name: located.path.slice(located.path.lastIndexOf('/') + 1), mediaType: mediaTypeFor(located.path, kind, snapshot.mediaType, head), bytes: snapshot.bytes });
        if ('error' in result) return failure(`${args.path} could not be converted to text: ${result.error}`, 'unavailable');
        text = result.text;
        await options.cache?.set(key, text);
      }
      return convertedPage(text, args.offset, args.limit);
    };
    return { ...tool, execute } as unknown as Tool;
  }

  return defineExtension({
    name: options.name ?? 'boring.files.read',
    wraps: [wrapTool(createReadTool() as ToolRegistration, converting)],
  });
}

/**
 * Adapts a Workers AI binding (`env.AI`, whose `toMarkdown` converts a file to Markdown) to a `FileConverter`. Typed loosely, so the
 * package needs no Cloudflare types.
 */
export function workersAiMarkdown(ai: { toMarkdown(input: { name: string; blob: Blob }): Promise<unknown> }): FileConverter {
  return async ({ name, mediaType, bytes }) => {
    const result = await ai.toMarkdown({ name, blob: new Blob([bytes as BlobPart], { type: mediaType }) }) as { format?: unknown; data?: unknown; error?: unknown } | undefined;
    if (result?.format === 'markdown' && typeof result.data === 'string') return { text: result.data };
    return { error: typeof result?.error === 'string' ? result.error : 'The file could not be converted to text.' };
  };
}
