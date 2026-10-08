// Which viewer opens a workspace file. Shared by the server (content types) and the browser (viewer choice).
const TYPES = {
  md: ['text/markdown', 'markdown'], markdown: ['text/markdown', 'markdown'],
  html: ['text/html', 'html'], htm: ['text/html', 'html'],
  png: ['image/png', 'image'], jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'], gif: ['image/gif', 'image'], webp: ['image/webp', 'image'], svg: ['image/svg+xml', 'image'],
  pdf: ['application/pdf', 'pdf'], tldraw: ['application/vnd.tldraw+json', 'canvas'],
  txt: ['text/plain', 'text'], json: ['application/json', 'text'], csv: ['text/csv', 'text'], js: ['text/javascript', 'text'], mjs: ['text/javascript', 'text'], css: ['text/css', 'text'],
};

const extensionOf = path => /\.([A-Za-z0-9]{1,8})$/.exec(path)?.[1]?.toLowerCase() ?? '';

/** The IANA media type for a path, `application/octet-stream` when unknown. */
export const mediaTypeOf = path => TYPES[extensionOf(path)]?.[0] ?? 'application/octet-stream';

/** `markdown`, `html`, `canvas`, `image`, `pdf` or `text` (anything else, shown as text when it decodes and as a download otherwise). */
export const kindOf = path => TYPES[extensionOf(path)]?.[1] ?? 'text';

/** Binary kinds are never decoded as text, whatever their bytes look like. */
export const isBinaryKind = path => ['image', 'pdf'].includes(kindOf(path)) && extensionOf(path) !== 'svg';
