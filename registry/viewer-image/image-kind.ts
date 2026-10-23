import type { ComponentType } from 'react';
import type { ImagePaneProps } from './image-pane';
import { IMAGE_TYPES } from './image-types';

/**
 * The image kind (D-257): PNG, JPEG, GIF, WebP and SVG files, read as bytes and shown by `ImagePane` (zoom and pan) in its own viewer bar.
 * This module is cheap (the match and the loader); the pane loads the first time an image opens. The pi-app `FileViewer` draws it.
 */
export interface ImageKind {
  readonly match: (target: { readonly resource: { readonly path: string } }, artifact: { readonly mediaType: string }) => boolean;
  readonly label?: string | undefined;
  /** A default viewer for a media type: a host's `viewers.image` wins over it. */
  readonly fallback: true;
  /** The kind reads the file's bytes (or the host's URL of a large file), not its text. */
  readonly media: 'image';
  readonly load: () => Promise<{ readonly default: ComponentType<ImagePaneProps> }>;
}

export const imageKind: ImageKind = {
  match: (_target, artifact) => Object.hasOwn(IMAGE_TYPES, artifact.mediaType),
  fallback: true, media: 'image',
  load: () => import('./image-pane').then(module => ({ default: module.ImagePane })),
};
