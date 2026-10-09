import { defineTool } from '@earendil-works/pi-durable';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { Context } from '@earendil-works/chord';
import type { ResourceAccess } from '@hachej/boring-files';
import { asWorkspaceResolver, workspaceFor } from './workspaces.js';
import type { WorkspaceBinding, WorkspaceResolver } from './workspaces.js';

/*
 * Reading the text of a non-text workspace file (PDF, image, office document). Pi's native `read` pages text files by line and
 * refuses images; this tool fills the gap. It converts the file once per saved revision and returns the text in bounded pages:
 * the agent reads the first page, and when the reply has `next`, calls again with that offset. Text files are refused here, and
 * they belong to `read`. Nothing is written.
 */

const DEFAULT_PAGE = 12_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const TEXT = /\.(md|markdown|txt|csv|tsv|json|html?|svg|xml|js|mjs|ts|css|py|sql|ya?ml|sh)$/i;

/** The converter: bytes to text, or `{ error }`. A failure is not cached. */
export type FileConverter = (file: { readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }) => Promise<{ readonly text: string } | { readonly error: string }>;

/** Converted text per `<path>@<revision>`. A `Map<string, string>` satisfies it. */
export interface ConvertedTextCache {
  get(key: string): string | undefined | Promise<string | undefined>;
  set(key: string, text: string): unknown;
}

export interface ConvertedTextToolOptions {
  /** The workspace of each call, resolved like the file guard's (`@hachej/boring-agent/workspaces`); absent: the env's workspace. */
  readonly workspace?: WorkspaceResolver | WorkspaceBinding | undefined;
  /** The agent's principal for the provider. Default: the binding's `access`. */
  readonly resolveAccess?: (api: ToolExecutionApi, context: Context) => ResourceAccess | Promise<ResourceAccess>;
  /** Converts a file to text. Without it, every non-text file answers `unsupported`. */
  readonly convert?: FileConverter;
  /** Stores converted text per revision. Without it, each read converts again. */
  readonly cache?: ConvertedTextCache;
  /** Characters per page. Default 12000. */
  readonly pageSize?: number;
  /** Largest file converted, in bytes. Default 20 MiB. */
  readonly maxBytes?: number;
}

const reply = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const surrogate = (code: number) => code >= 0xD800 && code <= 0xDBFF;

/** `read_converted_text({ path, offset? })`: one page of the converted text of a non-text workspace file. */
export function createConvertedTextTool(options: ConvertedTextToolOptions = {}) {
  const resolver = asWorkspaceResolver(options.workspace);
  const pageSize = options.pageSize ?? DEFAULT_PAGE;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new TypeError('pageSize must be a positive integer');
  return defineTool({
    name: 'read_converted_text',
    description: [
      'Read the text of a file that is not plain text (PDF, image, office document), converted to text, in pages of about 12000 characters.',
      'Read only what you need: start with offset 0, and when the reply has next, call again with that next value as offset to continue.',
      'For text files use read instead.',
    ].join(' '),
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 512, description: 'The file path, relative to the workspace.' }),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: 'The character offset to read from. Default 0; use the next value of the previous reply.' })),
    }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (args, api, context) => {
      const path = args.path.replace(/^\.\//, '');
      const offset = args.offset ?? 0;
      const resolved = await workspaceFor(resolver, api, context);
      if ('refused' in resolved) return reply({ kind: 'denied', reason: resolved.refused });
      const { files } = resolved.binding;
      const access = options.resolveAccess ? await options.resolveAccess(api, context) : resolved.binding.access;
      if (access === undefined) return reply({ kind: 'denied', reason: 'The host gave no access for this workspace' });
      if (TEXT.test(path)) return reply({ kind: 'denied', reason: 'This is a text file: read it with read.' });
      const target = { resource: { providerId: files.providerId, path }, view: { kind: 'published' as const } };
      const read = await files.read({ target, revision: { kind: 'latest' } }, { ...access });
      if (read.kind !== 'available') return reply(read.kind === 'missing' ? { kind: 'missing' } : read);
      const { snapshot } = read;
      if (snapshot.bytes.byteLength > maxBytes) return reply({ kind: 'denied', reason: `The file is larger than ${maxBytes} bytes` });
      if (!options.convert) return reply({ kind: 'unsupported', reason: 'This file type cannot be read as text here.' });

      const key = `${path}@${snapshot.ref.revision}`;
      let text = await options.cache?.get(key);
      const converted = text === undefined;
      if (text === undefined) {
        const result = await options.convert({ name: path.slice(path.lastIndexOf('/') + 1), mediaType: snapshot.mediaType, bytes: snapshot.bytes });
        if ('error' in result) return reply({ kind: 'unavailable', reason: result.error });
        text = result.text;
        await options.cache?.set(key, text);
      }

      const characters = text.length;
      if (offset > characters) return reply({ kind: 'denied', reason: 'The offset is past the end of the converted text.' });
      let end = Math.min(characters, offset + pageSize);
      // Never split a surrogate pair across pages.
      if (end < characters && end > offset && surrogate(text.charCodeAt(end - 1))) end -= 1;
      return reply({
        kind: 'available', path, revision: snapshot.ref.revision, characters, offset,
        ...(end < characters ? { next: end } : {}),
        ...(converted ? {} : { cached: true }),
        text: text.slice(offset, end),
      });
    },
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
