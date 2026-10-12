/**
 * The one place boring-files says what a file is: its extension, its media type (by name and by leading bytes), the viewer that
 * opens it, the provider's temporary and hidden names, the workspace path a user or agent typed, and the name of a new upload.
 * Callers import these; none keeps a copy. Pure: no Node, no DOM.
 */

/** The lower-case extension of the last path segment, or ''. */
export const extensionOf = (path: string): string => { const dot = path.lastIndexOf('.'); return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : ''; };

/** The IANA media type by extension. Anything not listed is `application/octet-stream` (see `mediaTypeOf`). */
export const MEDIA_TYPES: Readonly<Record<string, string>> = {
  md: 'text/markdown', markdown: 'text/markdown', html: 'text/html', htm: 'text/html', json: 'application/json', svg: 'image/svg+xml',
  txt: 'text/plain', csv: 'text/csv', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', tldraw: 'application/vnd.tldraw+json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf', epub: 'application/epub+zip',
};

/** The IANA media type of a path, `application/octet-stream` when unknown. */
export const mediaTypeOf = (path: string): string => MEDIA_TYPES[extensionOf(path)] ?? 'application/octet-stream';

/** The media type a file's leading bytes name (a PDF, PNG, JPEG, GIF or WebP signature), or undefined. */
export function sniffMediaType(head: Uint8Array): string | undefined {
  const at = (signature: readonly number[], offset = 0) => signature.every((byte, index) => head[offset + index] === byte);
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (at([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return undefined;
}

/** Which viewer opens a file. Anything not listed is shown as text when it decodes. */
export type ViewerKind = 'markdown' | 'html' | 'canvas' | 'image' | 'pdf' | 'text';

const VIEWER_KINDS: Readonly<Record<string, ViewerKind>> = {
  md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', tldraw: 'canvas',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', pdf: 'pdf',
  txt: 'text', json: 'text', csv: 'text', js: 'text', mjs: 'text', css: 'text',
};

/** The viewer kind of a path: `markdown`, `html`, `canvas`, `image`, `pdf` or `text`. */
export const viewerKindOf = (path: string): ViewerKind => VIEWER_KINDS[extensionOf(path)] ?? 'text';

/** Binary viewers never decode a file as text, whatever its bytes look like (an SVG is text). */
export const isBinaryKind = (path: string): boolean => ['image', 'pdf'].includes(viewerKindOf(path)) && extensionOf(path) !== 'svg';

/** The provider's temporary files are named `.boring-<uuid>.tmp` beside their target. They are removed when the provider opens and are never a resource. */
const temporaryPattern = /^\.boring-[0-9a-f-]{36}\.tmp$/;
/** The basename of a new temporary file, for a provider's `uuid`. */
export const temporaryFileName = (uuid: string): string => `.boring-${uuid}.tmp`;
/** Whether a path's last segment is one of the provider's temporary files (a lister hides them). */
export const isTemporary = (path: string): boolean => temporaryPattern.test(path.slice(path.lastIndexOf('/') + 1));

/** Names a presentation listing hides by default (dependency, build and internal folders, and the provider's own). Not an access policy. */
export const HIDDEN_NAMES: ReadonlySet<string> = new Set(['.git', '.boring', 'node_modules', 'dist', 'build', '.cache', '.next', 'coverage', '__pycache__']);

/** A path as a person or agent typed it, as a workspace-relative resource path: leading `./` and `/` segments removed. */
export const workspacePath = (path: string): string => path.replace(/^(\.?\/)+/, '');

/** A new upload's workspace path: `uploads/<stem>-<8 hex>.<ext>`, so a second `image.png` (every pasted screenshot has that name) is a new file beside the first. Whitespace becomes `_`, because a chat mention ends at a space. */
export function uploadPath(name: string, randomSuffix: string): string {
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const safe = (part: string) => part.replace(/\s+/g, '_');
  return `uploads/${safe(stem)}-${randomSuffix}${safe(extension)}`;
}
