'use client';

import { lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { PenToolIcon } from 'lucide-react';
import { drawingFormat, isDrawingPath } from './drawing';
import { drawingLabelsFor } from './drawing-labels';
import type { DrawingLabels, DrawingLocale } from './drawing-labels';

const DrawingViewer = lazy(() => import('./drawing-viewer').then(module => ({ default: module.DrawingViewer })));

/**
 * The artifact kind of a drawing file (structurally an `ArtifactKind` of pi-artifacts): it matches `.excalidraw` and `.drawio` files, names
 * them and draws them with `DrawingViewer`, loaded on first open. It is not in the pi-app-kinds default list: an app that shows drawings
 * adds it to its `artifactKinds` (and installs this item), so apps without drawings never install Excalidraw.
 */
export interface DrawingKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: { readonly text: string; readonly path?: string }) => ReactNode;
}

/** A drawing kind in `locale` ("Drawing", "Dessin") with any word overridden, and where the app serves Excalidraw's fonts. */
export function createDrawingKind({ locale, labels, excalidrawAssets }: { readonly locale?: DrawingLocale | undefined; readonly labels?: Partial<DrawingLabels> | undefined; readonly excalidrawAssets?: string | false | undefined } = {}): DrawingKind {
  return {
    match: target => isDrawingPath(target.resource.path),
    label: drawingLabelsFor(locale, labels).kind,
    icon: PenToolIcon,
    renderer: ({ text, path }) => <DrawingViewer text={text} format={drawingFormat(path, text)} locale={locale} labels={labels} excalidrawAssets={excalidrawAssets} />,
  };
}

/** The drawing kind, in English, with Excalidraw's fonts at the default path. */
export const drawingKind: DrawingKind = createDrawingKind();
