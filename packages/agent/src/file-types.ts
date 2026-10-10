/*
 * The one table of file types the agent package routes by. `read` (file-convert.ts) decides whether Pi's native read or the host's
 * converter handles a file; the mention resolver (mentions.ts) decides what to put in a message. Both ask `fileKind`.
 *
 *  - `text`: Pi's native read, untouched.
 *  - `pdf`, `office`, `image`: a host converter can turn them into text; Pi's read cannot (it returns garbage for a PDF).
 *  - `archive`: a container nothing here opens.
 *  - `binary`: any other file with a NUL byte.
 *
 * A file is classified by its extension AND its leading bytes: a PDF or an image is recognised by its magic number even under a
 * wrong name.
 */

export type FileKind = 'text' | 'pdf' | 'office' | 'image' | 'archive' | 'binary';

const TEXT = ['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'jsonl', 'html', 'htm', 'svg', 'xml', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'py', 'sql', 'yaml', 'yml', 'sh', 'toml', 'ini', 'log', 'rst', 'tex'];
const OFFICE = ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'epub'];

/** Image extensions and their media types; `native` ones a model reads as an image part without conversion. */
const IMAGES: Readonly<Record<string, { readonly mediaType: string; readonly native: boolean }>> = {
  png: { mediaType: 'image/png', native: true }, jpg: { mediaType: 'image/jpeg', native: true }, jpeg: { mediaType: 'image/jpeg', native: true },
  gif: { mediaType: 'image/gif', native: true }, webp: { mediaType: 'image/webp', native: true },
  bmp: { mediaType: 'image/bmp', native: false }, tif: { mediaType: 'image/tiff', native: false }, tiff: { mediaType: 'image/tiff', native: false },
};

const BY_EXTENSION: ReadonlyMap<string, FileKind> = new Map<string, FileKind>([
  ...TEXT.map(extension => [extension, 'text'] as const),
  ...OFFICE.map(extension => [extension, 'office'] as const),
  ...Object.keys(IMAGES).map(extension => [extension, 'image'] as const),
  ['pdf', 'pdf'], ['zip', 'archive'],
]);

/** The lower-case extension of the last path segment, or ''. */
export const extensionOf = (path: string): string => { const dot = path.lastIndexOf('.'); return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : ''; };

/** The media type of a native image (png, jpeg, gif, webp) by extension, or undefined. */
export const nativeImageType = (path: string): string | undefined => { const image = IMAGES[extensionOf(path)]; return image?.native ? image.mediaType : undefined; };

/** How many leading bytes `fileKind` looks at. */
export const SNIFF_BYTES = 16;

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) => signature.every((byte, index) => bytes[at + index] === byte);

/** The kind a magic number names, or undefined. A ZIP signature is an office document only under an office extension. */
function kindByMagic(bytes: Uint8Array, extension: string): FileKind | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38])
    || (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) || startsWith(bytes, [0x42, 0x4d]) && extension === 'bmp') return 'image';
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

const OFFICE_TYPES: Readonly<Record<string, string>> = {
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf', epub: 'application/epub+zip',
};

/** The media type a converter should be told for a file of this kind: the provider's when it names one, else the table's (a provider often says `application/octet-stream`). */
export function mediaTypeFor(path: string, kind: FileKind, provided: string | undefined): string {
  if (provided && provided !== 'application/octet-stream') return provided;
  const extension = extensionOf(path);
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'image') return IMAGES[extension]?.mediaType ?? 'application/octet-stream';
  return OFFICE_TYPES[extension] ?? 'application/octet-stream';
}
