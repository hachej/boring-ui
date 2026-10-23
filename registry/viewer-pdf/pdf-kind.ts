import type { ComponentType } from 'react';
import type { PdfPaneProps } from './pdf-pane';

/**
 * The PDF kind (D-257): `application/pdf` files, read as bytes and shown by `PdfPane` in its own viewer bar. This module is cheap; the
 * pane (and pdf.js, which the pane loads only when the browser has no PDF viewer) loads the first time a PDF opens.
 */
export interface PdfKind {
  readonly match: (target: { readonly resource: { readonly path: string } }, artifact: { readonly mediaType: string }) => boolean;
  readonly label?: string | undefined;
  readonly fallback: true;
  readonly media: 'pdf';
  readonly load: () => Promise<{ readonly default: ComponentType<PdfPaneProps> }>;
}

export const pdfKind: PdfKind = {
  match: (_target, artifact) => artifact.mediaType === 'application/pdf',
  fallback: true, media: 'pdf',
  load: () => import('./pdf-pane').then(module => ({ default: module.PdfPane })),
};
