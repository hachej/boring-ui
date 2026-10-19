import { isBinaryKind } from '@hachej/boring-files/file-types';
import type { ViewerKind } from '@hachej/boring-files/file-types';

/** The viewer kinds, media types and extensions live in `@hachej/boring-files/file-types`; this keeps only what the viewers show. */
export const KIND_LABEL: Readonly<Record<ViewerKind, string>> = { markdown: 'Markdown', html: 'HTML', canvas: 'Canvas', image: 'Image', pdf: 'PDF', video: 'Video', text: 'Text' };

/** The text of a file, or `undefined` when it is binary: an image, PDF or video kind (SVG excepted), a NUL byte, or bytes that are not UTF-8. */
export function decodeText(path: string, bytes: Uint8Array): string | undefined {
  if (isBinaryKind(path) || bytes.includes(0)) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return undefined; }
}
