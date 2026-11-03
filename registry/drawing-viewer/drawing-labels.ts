/* The drawing viewer's words in English and French. `locale` picks the base set; a host's `labels` still override any of them. */
import type { DrawingFailure, DrawingFormat } from './drawing';

export type DrawingLocale = 'en' | 'fr';

export const defaultDrawingLabels = {
  /** The kind's name on the artifact card and in the panel bar. */
  kind: 'Drawing',
  loading: 'Drawing…',
  /** The image's text alternative. */
  image: (format: DrawingFormat, shapes: number, arrows: number) => `${format === 'drawio' ? 'draw.io' : 'Excalidraw'} drawing: ${shapes} shapes, ${arrows} arrows`,
  errorTitle: 'This drawing cannot be shown',
  error: (reason: DrawingFailure) => reason === 'unreadable' ? 'The file is not an Excalidraw (.excalidraw) or draw.io (.drawio) drawing, or it is damaged.'
    : reason === 'empty' ? 'The drawing is empty: there is nothing to draw.' : 'The drawing could not be drawn. Try opening it again.',
};
export type DrawingLabels = typeof defaultDrawingLabels;

/** Typed as `DrawingLabels`, so a key added in English must be added here too. */
export const frenchDrawingLabels: DrawingLabels = {
  kind: 'Dessin',
  loading: 'Dessin en cours…',
  image: (format, shapes, arrows) => `Dessin ${format === 'drawio' ? 'draw.io' : 'Excalidraw'} : ${shapes} formes, ${arrows} flèches`,
  errorTitle: 'Ce dessin ne peut pas être affiché',
  error: reason => reason === 'unreadable' ? 'Le fichier n’est pas un dessin Excalidraw (.excalidraw) ou draw.io (.drawio), ou il est abîmé.'
    : reason === 'empty' ? 'Le dessin est vide : il n’y a rien à dessiner.' : 'Le dessin n’a pas pu être tracé. Rouvrez-le.',
};

/** The viewer's words for `locale` (English by default) with the host's overrides. */
export const drawingLabelsFor = (locale: DrawingLocale | undefined, labels?: Partial<DrawingLabels>): DrawingLabels =>
  ({ ...(locale === 'fr' ? frenchDrawingLabels : defaultDrawingLabels), ...labels });
