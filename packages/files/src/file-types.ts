/**
 * The one place boring-files says what a file is: its extension, its media type (by name and by leading bytes), the viewer that
 * opens it, the provider's temporary and hidden names, the workspace path a user or agent typed, and the name of a new upload.
 * Callers import these; none keeps a copy. Pure: no Node, no DOM.
 */

/** The lower-case extension of the last path segment, or ''. */
export const extensionOf = (path: string): string => { const dot = path.lastIndexOf('.'); return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : ''; };

/** The IANA media type by extension. Anything not listed is `application/octet-stream` (see `mediaTypeOf`). Null-prototype: `constructor` or `__proto__` is not an entry. */
export const MEDIA_TYPES: Readonly<Record<string, string>> = Object.assign(Object.create(null), {
  md: 'text/markdown', markdown: 'text/markdown', html: 'text/html', htm: 'text/html', json: 'application/json', svg: 'image/svg+xml',
  txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', tldraw: 'application/vnd.tldraw+json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', ogg: 'video/ogg', ogv: 'video/ogg',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf', epub: 'application/epub+zip',
});

/** The IANA media type of a path, `application/octet-stream` when unknown. */
export const mediaTypeOf = (path: string): string => MEDIA_TYPES[extensionOf(path)] ?? 'application/octet-stream';

/** How many leading bytes `sniffMediaType` looks at: a caller reads this many and passes them in. */
export const SNIFF_BYTES = 8192;

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const u16 = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const u32 = (bytes: Uint8Array, at: number) => (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heif']);
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash']);
/**
 * HEIC/HEIF by their ISO-BMFF `ftyp` box: a HEVC brand (`heic`, `heix`, `hevc`, …) is HEIC; the generic image brands (`mif1`, `msf1`)
 * are HEIC when a compatible brand says HEVC, HEIF otherwise, and nothing when a compatible brand says AVIF (not claimed here).
 */
function sniffHeif(head: Uint8Array): string | undefined {
  if (head.length < 16 || ascii(head.subarray(4, 8)) !== 'ftyp') return undefined;
  const major = ascii(head.subarray(8, 12));
  const end = Math.min(head.length, Math.max(16, (head[0]! << 24 | head[1]! << 16 | head[2]! << 8 | head[3]!) >>> 0));
  const compatible = new Set<string>();
  for (let at = 16; at + 4 <= end; at += 4) compatible.add(ascii(head.subarray(at, at + 4)));
  if (HEIC_BRANDS.has(major)) return 'image/heic';
  if (!HEIF_BRANDS.has(major)) return undefined;
  if (compatible.has('avif') || compatible.has('avis')) return undefined;
  return [...compatible].some(brand => HEIC_BRANDS.has(brand)) ? 'image/heic' : 'image/heif';
}

const OOXML_MAIN: readonly (readonly [string, string, string])[] = [
  ['wordprocessingml.document.main', 'word/', MEDIA_TYPES.docx!],
  ['spreadsheetml.sheet.main', 'xl/', MEDIA_TYPES.xlsx!],
  ['presentationml.presentation.main', 'ppt/', MEDIA_TYPES.pptx!],
];
const ZIP_MIMETYPES = new Set([MEDIA_TYPES.odt, MEDIA_TYPES.ods, MEDIA_TYPES.odp, MEDIA_TYPES.epub]);
/**
 * Zip-based documents from the head alone, without inflating anything: it walks the local file headers that fit in `head`.
 *  - OpenDocument and EPUB: a first entry `mimetype`, stored uncompressed, holds the media type itself.
 *  - Office Open XML (docx, xlsx, pptx): a `[Content_Types].xml` entry, then the main part's content type when that entry is stored
 *    uncompressed, or else the folder of a later entry (`word/`, `xl/`, `ppt/`). Its content is almost always deflated, and inflating
 *    is asynchronous in a browser, so the folder rule is the usual one.
 * A zip whose entries have unknown sizes (a data descriptor) cannot be walked past its first entry; it is then not claimed.
 */
function sniffZip(head: Uint8Array): string | undefined {
  let contentTypes = false;
  for (let offset = 0, index = 0; index < 64 && offset + 30 <= head.length && u32(head, offset) === 0x04034b50; index++) {
    const flags = u16(head, offset + 6), method = u16(head, offset + 8), size = u32(head, offset + 18);
    const nameStart = offset + 30, nameEnd = nameStart + u16(head, offset + 26), dataStart = nameEnd + u16(head, offset + 28);
    if (nameEnd > head.length) return undefined;
    const name = ascii(head.subarray(nameStart, nameEnd));
    const stored = method === 0 && (flags & 8) === 0 && dataStart + size <= head.length ? ascii(head.subarray(dataStart, dataStart + size)) : undefined;
    if (index === 0 && name === 'mimetype' && stored !== undefined) return ZIP_MIMETYPES.has(stored.trim()) ? stored.trim() : undefined;
    if (name === '[Content_Types].xml') {
      contentTypes = true;
      const named = stored === undefined ? undefined : OOXML_MAIN.find(([main]) => stored.includes(`${main}+xml`));
      if (named) return named[2];
    } else if (contentTypes) {
      const folder = OOXML_MAIN.find(([, prefix]) => name.startsWith(prefix));
      if (folder) return folder[2];
    }
    if (flags & 8) return undefined;
    offset = dataStart + size;
  }
  return undefined;
}

/**
 * The media type a file's leading bytes name, or undefined. Pass up to `SNIFF_BYTES` of them.
 *  - Signatures: PDF, PNG, JPEG, GIF, WebP, HEIC/HEIF and MP4/MOV/M4V (`ftyp` brands), WebM (EBML), and zip-based documents.
 *  - Otherwise `text/plain` when the bytes are valid UTF-8 (a character cut at the end is allowed) with no NUL byte: a weak answer, a
 *    name says better which text it is (`delimitedTextType` for CSV and TSV).
 */
export function sniffMediaType(head: Uint8Array): string | undefined {
  const at = (signature: readonly number[], offset = 0) => signature.every((byte, index) => head[offset + index] === byte);
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (at([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  const heif = sniffHeif(head);
  if (heif) return heif;
  if (head.length >= 16 && ascii(head.subarray(4, 8)) === 'ftyp') {
    const brand = ascii(head.subarray(8, 12));
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand === 'M4V ' || brand === 'M4VH' || brand === 'M4VP') return 'video/x-m4v';
    if (MP4_BRANDS.has(brand)) return 'video/mp4';
  }
  if (at([0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (at([0x50, 0x4b, 0x03, 0x04])) return sniffZip(head.subarray(0, SNIFF_BYTES));
  const sample = head.subarray(0, SNIFF_BYTES);
  if (sample.length === 0 || sample.includes(0)) return undefined;
  try { new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true }); return 'text/plain'; } catch { return undefined; }
}

/** CSV or TSV: content alone cannot tell them from other text, so the name says which and the bytes must be text. Undefined otherwise. */
export function delimitedTextType(path: string, head: Uint8Array): 'text/csv' | 'text/tab-separated-values' | undefined {
  const extension = extensionOf(path);
  if (extension !== 'csv' && extension !== 'tsv') return undefined;
  if (sniffMediaType(head) !== 'text/plain') return undefined;
  return extension === 'csv' ? 'text/csv' : 'text/tab-separated-values';
}

/** Which viewer opens a file. Anything not listed is shown as text when it decodes. */
export type ViewerKind = 'markdown' | 'html' | 'canvas' | 'image' | 'pdf' | 'video' | 'text';

const VIEWER_KINDS: Readonly<Record<string, ViewerKind>> = Object.assign(Object.create(null), {
  md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', tldraw: 'canvas',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', pdf: 'pdf',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogg: 'video', ogv: 'video',
  txt: 'text', json: 'text', csv: 'text', js: 'text', mjs: 'text', css: 'text',
});

/** The viewer kind of a path: `markdown`, `html`, `canvas`, `image`, `pdf`, `video` or `text`. */
export const viewerKindOf = (path: string): ViewerKind => VIEWER_KINDS[extensionOf(path)] ?? 'text';

/** Binary viewers never decode a file as text, whatever its bytes look like (an SVG is text). */
export const isBinaryKind = (path: string): boolean => ['image', 'pdf', 'video'].includes(viewerKindOf(path)) && extensionOf(path) !== 'svg';

/** The provider's temporary files are named `.boring-<uuid>.tmp` beside their target. They are removed when the provider opens and are never a resource. */
const temporaryPattern = /^\.boring-[0-9a-f-]{36}\.tmp$/;
/** The basename of a new temporary file, for a provider's `uuid`. */
export const temporaryFileName = (uuid: string): string => `.boring-${uuid}.tmp`;
/** Whether a path's last segment is one of the provider's temporary files (a lister hides them). */
export const isTemporary = (path: string): boolean => temporaryPattern.test(path.slice(path.lastIndexOf('/') + 1));

/** Names a presentation listing hides by default (dependency, build and internal folders, and the provider's own). Not an access policy. */
export const HIDDEN_NAMES: ReadonlySet<string> = new Set(['.git', '.boring', 'node_modules', 'dist', 'build', '.cache', '.next', 'coverage', '__pycache__']);

/** A path as a person or agent typed it, as a workspace-relative resource path: leading `./` segments removed. A leading `/` stays: it is not a workspace path, and the provider refuses it rather than reading it as a relative one. */
export const workspacePath = (path: string): string => path.replace(/^(\.\/)+/, '');

/** A new upload's workspace path: `uploads/<stem>-<8 hex>.<ext>`, so a second `image.png` (every pasted screenshot has that name) is a new file beside the first. Whitespace becomes `_`, because a chat mention ends at a space. */
export function uploadPath(name: string, randomSuffix: string): string {
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const safe = (part: string) => part.replace(/\s+/g, '_');
  return `uploads/${safe(stem)}-${randomSuffix}${safe(extension)}`;
}
