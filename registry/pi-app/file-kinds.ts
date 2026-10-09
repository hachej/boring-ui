/** Which viewer opens a file: `markdown`, `html`, `canvas`, `image`, `pdf` or `text` (anything else, shown as text when it decodes). */
export type FileKind = 'markdown' | 'html' | 'canvas' | 'image' | 'pdf' | 'text';

const TYPES: Readonly<Record<string, readonly [string, FileKind]>> = {
  md: ['text/markdown', 'markdown'], markdown: ['text/markdown', 'markdown'],
  html: ['text/html', 'html'], htm: ['text/html', 'html'],
  png: ['image/png', 'image'], jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'], gif: ['image/gif', 'image'], webp: ['image/webp', 'image'], svg: ['image/svg+xml', 'image'],
  pdf: ['application/pdf', 'pdf'], tldraw: ['application/vnd.tldraw+json', 'canvas'],
  txt: ['text/plain', 'text'], json: ['application/json', 'text'], csv: ['text/csv', 'text'], js: ['text/javascript', 'text'], mjs: ['text/javascript', 'text'], css: ['text/css', 'text'],
};

export const extensionOf = (path: string): string => /\.([A-Za-z0-9]{1,8})$/.exec(path)?.[1]?.toLowerCase() ?? '';
/** The IANA media type for a path, `application/octet-stream` when unknown. */
export const mediaTypeOf = (path: string): string => TYPES[extensionOf(path)]?.[0] ?? 'application/octet-stream';
export const kindOf = (path: string): FileKind => TYPES[extensionOf(path)]?.[1] ?? 'text';
export const KIND_LABEL: Readonly<Record<FileKind, string>> = { markdown: 'Markdown', html: 'HTML', canvas: 'Canvas', image: 'Image', pdf: 'PDF', text: 'Text' };

/** The text of a file, or `undefined` when it is binary: an image or PDF kind (SVG excepted), a NUL byte, or bytes that are not UTF-8. */
export function decodeText(path: string, bytes: Uint8Array): string | undefined {
  if ((['image', 'pdf'].includes(kindOf(path)) && extensionOf(path) !== 'svg') || bytes.includes(0)) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; }
}
