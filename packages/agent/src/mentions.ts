import type { Context } from '@earendil-works/chord';
import type { InputSubmissionDraft } from '@earendil-works/pi-durable';
import type { FileSystem } from '@earendil-works/pi-durable/env';

/** The native input content a submission carries: a string, or text and image parts. */
export type MentionInput = InputSubmissionDraft['content'];
type Part = Exclude<MentionInput, string>[number];

/** What a host reader returns for one workspace path. `bytes` is absent when the file is too large to read. */
export interface MentionFile { readonly size: number; readonly bytes?: Uint8Array }
/** Read one workspace-relative path. Return undefined when it is missing, outside the workspace or unreadable. Never throw to refuse. */
export type MentionReader = (path: string) => Promise<MentionFile | undefined>;

export interface MentionLimits {
  /** Largest part of one file given to the model; more is cut and the cut is stated. Default 100 KB. */
  readonly fileBytes?: number;
  /** Most bytes of file content in one message. Later files become a note. Default 300 KB. */
  readonly totalBytes?: number;
  /** Most distinct mentions resolved in one message. Default 20. */
  readonly files?: number;
}
export interface MentionResolverOptions { readonly read: MentionReader; readonly limits?: MentionLimits }

export const MENTION_LIMITS = Object.freeze({ fileBytes: 100_000, totalBytes: 300_000, files: 20 });
/** Every part this module adds starts with this prefix, so a viewer can tell it from what the person typed. */
export const MENTION_FILE_PREFIX = '<file path="';

const IMAGE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** The `@path` tokens of a message: at the start or after whitespace; a bare path drops trailing punctuation, a quoted `@"a b.md"` (escapes `\"`, `\\`) is taken as written. The syntax pi-chat produces. The registry item `pi-chat` cannot import this, so it copies the
 * parser (`MENTION_TOKEN` and `pieces` in `registry/pi-chat/config.ts`); `test/contracts/pi-chat-source.test.mjs` keeps the two equal. */
export function mentionedPaths(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(^|\s)@(?:"((?:[^"\\]|\\.)*)"|([^\s]+))/g)) {
    const path = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3]!.replace(/[.,;:!?)\]}'"]+$/, '');
    if (path) found.add(path);
  }
  return [...found];
}

/** A workspace-relative path with no absolute prefix, no `..`, no backslash and no control characters. */
export function safeMentionPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f]/.test(path) || /^[A-Za-z]:/.test(path)) return false;
  return !path.split('/').some(segment => segment === '..' || segment === '');
}

const attribute = (value: string) => value.replace(/"/g, '%22').replace(/</g, '%3C');
const note = (path: string, reason: string): Part => ({ type: 'text', text: `${MENTION_FILE_PREFIX}${attribute(path)}" unavailable="${attribute(reason)}" />` });

function utf8(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return undefined; }
}
/** Cut at a character boundary: a split multi-byte tail is dropped rather than shown as a replacement character. */
function utf8Prefix(bytes: Uint8Array, limit: number): string | undefined {
  for (let end = Math.min(limit, bytes.length), tries = 0; tries < 4 && end > 0; tries++, end--) {
    const text = utf8(bytes.subarray(0, end));
    if (text !== undefined) return text;
  }
  return undefined;
}
const base64 = (bytes: Uint8Array) => { let binary = ''; for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000)); return btoa(binary); };

/**
 * Turn `@workspace/path` mentions of a submitted input into content the model can read, on the host and at submit
 * time, so an agent with no file tool still sees what the person attached. The `@path` text stays in the message. A
 * text file becomes a `<file path="...">` text part, an image a native image part, and a binary, oversized, missing,
 * unreadable or over-budget file one short note. It never throws: an input it cannot improve is returned unchanged.
 */
export function createMentionResolver(options: MentionResolverOptions): (content: MentionInput) => Promise<MentionInput> {
  const limits = { ...MENTION_LIMITS, ...options.limits };
  return async content => {
    try {
      const parts: readonly Part[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
      const paths = mentionedPaths(parts.map(part => part.type === 'text' ? part.text : '').join('\n')).slice(0, limits.files);
      if (!paths.length) return content;
      const added: Part[] = [];
      let used = 0;
      for (const path of paths) {
        if (!safeMentionPath(path)) { added.push(note(path, 'not a path inside the workspace')); continue; }
        let file: MentionFile | undefined;
        try { file = await options.read(path); } catch { file = undefined; }
        if (!file) { added.push(note(path, 'not found or not readable')); continue; }
        const bytes = file.bytes;
        const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        const image = IMAGE_TYPES[extension];
        if (!bytes) { added.push(note(path, `too large to attach (${file.size} bytes)`)); continue; }
        if (used >= limits.totalBytes) { added.push(note(path, `skipped: the ${limits.totalBytes} byte limit for one message was reached`)); continue; }
        if (image) {
          if (bytes.length > limits.fileBytes || used + bytes.length > limits.totalBytes) { added.push(note(path, `image too large to attach (${bytes.length} bytes)`)); continue; }
          used += bytes.length;
          added.push({ type: 'text', text: `${MENTION_FILE_PREFIX}${attribute(path)}" type="${image}" size="${bytes.length}" />` }, { type: 'image', data: base64(bytes), mimeType: image });
          continue;
        }
        const room = Math.min(limits.fileBytes, limits.totalBytes - used);
        const text = bytes.length <= room ? utf8(bytes) : utf8Prefix(bytes, room);
        if (text === undefined) { added.push(note(path, `binary file, ${bytes.length} bytes; content not included`)); continue; }
        const cut = bytes.length > room;
        used += Math.min(bytes.length, room);
        added.push({ type: 'text', text: `${MENTION_FILE_PREFIX}${attribute(path)}"${cut ? ` truncated="showing the first ${new TextEncoder().encode(text).length} of ${bytes.length} bytes"` : ''}>\n${text.replace(/<\/file>/g, '<\\/file>')}\n</file>` });
      }
      return [...parts, ...added];
    } catch { return content; }
  };
}

type ReadableFiles = Pick<FileSystem, 'cwd' | 'canonicalPath' | 'fileInfo' | 'readBinaryFile'>;
/**
 * A `MentionReader` over a native `FileSystem` (the workspace's `ExecutionEnv` is one). Paths are relative to `root`
 * (default the environment's `cwd`); the canonical path must stay inside the canonical root, so a symlink cannot lead
 * out. Files above `maxReadBytes` (default 5 MB) are reported by size and not read.
 */
export function fileSystemMentionReader(fs: ReadableFiles, context: Context, options: { readonly root?: string; readonly maxReadBytes?: number } = {}): MentionReader {
  const maxRead = options.maxReadBytes ?? 5_000_000;
  return async path => {
    if (!safeMentionPath(path)) return undefined;
    const base = (options.root ?? fs.cwd).replace(/\/+$/, '');
    const root = await fs.canonicalPath(base, context);
    const target = await fs.canonicalPath(`${base}/${path}`, context);
    if (!root.ok || !target.ok || !target.value.startsWith(`${root.value.replace(/\/+$/, '')}/`)) return undefined;
    const info = await fs.fileInfo(target.value, context);
    if (!info.ok || info.value.kind !== 'file') return undefined;
    if (info.value.size > maxRead) return { size: info.value.size };
    const bytes = await fs.readBinaryFile(target.value, context);
    return bytes.ok ? { size: bytes.value.length, bytes: bytes.value } : undefined;
  };
}
