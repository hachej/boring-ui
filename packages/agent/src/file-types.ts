/*
 * The file kinds the agent package routes by. `read` (file-convert.ts) decides whether Pi's native read or the host's converter
 * handles a file; the mention resolver (mentions.ts) decides what to put in a message. Both ask `fileKind`.
 * Media types, extensions and magic numbers come from `@hachej/boring-files/file-types`; this file only says which kind each is.
 *
 *  - `text`: Pi's native read, untouched.
 *  - `pdf`, `office`, `image`: a host converter can turn them into text; Pi's read cannot (it returns garbage for a PDF).
 *  - `archive`: a container nothing here opens.
 *  - `binary`: any other file with a NUL byte.
 *
 * A file is classified by its extension AND its leading bytes: a PDF or an image is recognised by its magic number even under a
 * wrong name.
 */

import { MEDIA_TYPES, extensionOf, sniffMediaType } from '@hachej/boring-files/file-types';

export type FileKind = 'text' | 'pdf' | 'office' | 'image' | 'archive' | 'binary';

const TEXT = ['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'jsonl', 'html', 'htm', 'svg', 'xml', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'py', 'sql', 'yaml', 'yml', 'sh', 'toml', 'ini', 'log', 'rst', 'tex'];
const OFFICE = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'epub'];

/** Image extensions; `native` ones a model reads as an image part without conversion. Their media types are `MEDIA_TYPES`. */
const IMAGES: Readonly<Record<string, boolean>> = { png: true, jpg: true, jpeg: true, gif: true, webp: true, bmp: false, tif: false, tiff: false };

const BY_EXTENSION: ReadonlyMap<string, FileKind> = new Map<string, FileKind>([
  ...TEXT.map(extension => [extension, 'text'] as const),
  ...OFFICE.map(extension => [extension, 'office'] as const),
  ...Object.keys(IMAGES).map(extension => [extension, 'image'] as const),
  ['pdf', 'pdf'], ['zip', 'archive'],
]);

/** The media type of a native image (png, jpeg, gif, webp) by extension, or undefined. */
export const nativeImageType = (path: string): string | undefined => IMAGES[extensionOf(path)] ? MEDIA_TYPES[extensionOf(path)] : undefined;

/** How many leading bytes `fileKind` looks at. */
export const SNIFF_BYTES = 16;

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((byte, index) => bytes[at + index] === byte);

/** The kind a magic number names, or undefined. A ZIP signature is an office document only under an office extension. */
function kindByMagic(bytes: Uint8Array, extension: string): FileKind | undefined {
  const sniffed = sniffMediaType(bytes);
  if (sniffed === 'application/pdf') return 'pdf';
  if (sniffed?.startsWith('image/') || (startsWith(bytes, [0x42, 0x4d]) && extension === 'bmp')) return 'image';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return OFFICE.includes(extension) ? 'office' : 'archive';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return 'office';
  return undefined;
}

/** The kind of `path`, from its extension and, when given, its leading bytes (the magic number wins). Unknown extensions are text unless a NUL byte says otherwise. */
export function fileKind(path: string, head?: Uint8Array): FileKind {
  const extension = extensionOf(path);
  const named = BY_EXTENSION.get(extension);
  if (head !== undefined) {
    const magic = kindByMagic(head, extension);
    if (magic !== undefined) return magic;
    if (named === undefined || named === 'text') return head.includes(0) ? 'binary' : 'text';
  }
  return named ?? 'text';
}

/**
 * The media type a converter should be told. A signature in the leading bytes wins over everything (a PDF named `.txt` is
 * `application/pdf`, whatever the provider derived from the name); then the provider's type unless it is generic; then the table's.
 */
export function mediaTypeFor(path: string, kind: FileKind, provided: string | undefined, head?: Uint8Array): string {
  const sniffed = head === undefined ? undefined : sniffMediaType(head);
  if (sniffed !== undefined) return sniffed;
  const extension = extensionOf(path);
  const table = kind === 'pdf' ? MEDIA_TYPES.pdf : kind === 'image' && IMAGES[extension] !== undefined ? MEDIA_TYPES[extension] : kind === 'office' && OFFICE.includes(extension) ? MEDIA_TYPES[extension] : undefined;
  const generic = !provided || provided === 'application/octet-stream' || provided.startsWith('text/') || provided === 'application/zip';
  if (!generic) return provided;
  return table ?? provided ?? 'application/octet-stream';
}
