/**
 * The one place boring-files says what a file is: its extension, its media type, the viewer that opens it, the rule for the
 * provider's own temporary files and the name of a new upload. Callers import these; none keeps a copy.
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

/** Which viewer opens a file. Anything not listed is shown as text when it decodes. */
export type ViewerKind = 'markdown' | 'html' | 'canvas' | 'image' | 'pdf' | 'text';

const VIEWER_KINDS: Readonly<Record<string, ViewerKind>> = {
  md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', tldraw: 'canvas',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', pdf: 'pdf',
  txt: 'text', json: 'text', csv: 'text', js: 'text', mjs: 'text', css: 'text',
};

/** The viewer kind of a path: `markdown`, `html`, `canvas`, `image`, `pdf` or `text`. */
export const viewerKindOf = (path: string): ViewerKind => VIEWER_KINDS[extensionOf(path)] ?? 'text';

/** The provider's own temporary files. They are removed when the provider opens and are never a resource. */
const temporaryPattern = /^\.boring-[0-9a-f-]{36}\.tmp$/;
/** Whether a path is one of the provider's temporary files (a lister hides them). */
export const isTemporary = (path: string) => temporaryPattern.test(path.slice(path.lastIndexOf('/') + 1));

/** A new upload's workspace path: `uploads/<stem>-<8 hex>.<ext>`, so a second `image.png` (every pasted screenshot has that name) is a new file beside the first. Whitespace becomes `_`, because a chat mention ends at a space. */
export function uploadPath(name: string, randomSuffix: string): string {
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const safe = (part: string) => part.replace(/\s+/g, '_');
  return `uploads/${safe(stem)}-${randomSuffix}${safe(extension)}`;
}

/** Binary viewers never decode a file as text, whatever its bytes look like (an SVG is text). */
export const isBinaryKind = (path: string): boolean => ['image', 'pdf'].includes(viewerKindOf(path)) && extensionOf(path) !== 'svg';
