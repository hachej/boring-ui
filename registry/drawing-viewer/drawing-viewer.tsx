'use client';

// The drawing viewer (D-1398): an Excalidraw or draw.io file, read-only, drawn by the tool's own renderer on a white page fitted to the
// shapes. Excalidraw draws with its library (`exportToSvg`); draw.io with the official diagrams.net viewer in a sandboxed frame without
// network. Each renderer loads the first time a drawing of its format opens. The result is shown as an image from a blob URL, so nothing
// in the file runs on this page, and what the renderer read goes to `onRead` (shapes and arrows, see drawing.ts) for describing it to a model.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { DrawingError, drawingFormat } from './drawing';
import type { Drawing, DrawingFailure, DrawingFormat, RenderedDrawing } from './drawing';
import { drawingLabelsFor } from './drawing-labels';
import type { DrawingLabels, DrawingLocale } from './drawing-labels';

export { boundsOf, describeDrawing, DrawingError, drawingFormat, isDrawingPath } from './drawing';
export type { Drawing, DrawingArrow, DrawingFailure, DrawingFormat, DrawingShape, RenderedDrawing } from './drawing';
export { defaultDrawingLabels, drawingLabelsFor, frenchDrawingLabels } from './drawing-labels';
export type { DrawingLabels, DrawingLocale } from './drawing-labels';

/** Where the app serves Excalidraw's fonts by default: the package's `dist/prod` folder (its `fonts/` inside) at this path. */
export const DEFAULT_EXCALIDRAW_ASSETS = '/excalidraw/';

export interface DrawingViewerProps {
  /** The file's text. */
  readonly text: string;
  /** The file's path or name: `.excalidraw` or `.drawio` picks the format; without it the text decides. */
  readonly path?: string | undefined;
  /** The format, when the app knows it better than the path. */
  readonly format?: DrawingFormat | undefined;
  /** The drawing's name, for the reader. */
  readonly title?: string | undefined;
  /** Called with what the renderer read once the drawing is drawn, and what it was refused from the network (those parts are not drawn). */
  readonly onRead?: ((drawing: Drawing, details: { readonly blocked: readonly string[] }) => void) | undefined;
  /**
   * The URL of the folder where the app serves `@excalidraw/excalidraw/dist/prod/` (Excalidraw looks for `fonts/` in it), unless the page
   * set `window.EXCALIDRAW_ASSET_PATH` itself. `false`, or a folder that serves no font, draws text without Excalidraw's fonts; the
   * viewer never lets Excalidraw fetch them from its CDN.
   */
  readonly excalidrawAssets?: string | false | undefined;
  /** The base words: English by default. */
  readonly locale?: DrawingLocale | undefined;
  /** Any word over the locale's. */
  readonly labels?: Partial<DrawingLabels> | undefined;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'drawn'; readonly rendered: RenderedDrawing; readonly url: string }
  | { readonly kind: 'error'; readonly reason: DrawingFailure };

async function render(format: DrawingFormat, text: string, assets: string | false, signal: AbortSignal): Promise<RenderedDrawing> {
  if (format === 'excalidraw') return (await import('./excalidraw-render')).renderExcalidraw(text, { assets });
  return (await import('./drawio-render')).renderDrawio(text, { signal });
}

/** One drawing; an unreadable or empty file shows an inline error. */
export function DrawingViewer({ text, path, format: given, title, onRead, excalidrawAssets = DEFAULT_EXCALIDRAW_ASSETS, locale, labels: words }: DrawingViewerProps) {
  const labels = useMemo(() => drawingLabelsFor(locale, words), [locale, words]);
  const format = given ?? drawingFormat(path, text);
  // The outcome of the drawing it was rendered for: another text, format or font folder shows loading until its own outcome lands.
  const [outcome, setOutcome] = useState<{ readonly text: string; readonly format: DrawingFormat; readonly assets: string | false; readonly state: State }>();
  const state: State = !format ? { kind: 'error', reason: 'unreadable' }
    : outcome && outcome.text === text && outcome.format === format && outcome.assets === excalidrawAssets ? outcome.state : { kind: 'loading' };
  const read = useRef(onRead);
  useLayoutEffect(() => { read.current = onRead; });
  // A drawn outcome's image lives until another outcome replaces it or the viewer unmounts, so going back to an earlier text never shows a
  // revoked image; that text is drawn again anyway.
  useEffect(() => {
    const url = outcome?.state.kind === 'drawn' ? outcome.state.url : undefined;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [outcome]);
  useEffect(() => {
    if (!format) return;
    const abort = new AbortController();
    render(format, text, excalidrawAssets, abort.signal).then(rendered => {
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([rendered.svg], { type: 'image/svg+xml' }));
      setOutcome({ text, format, assets: excalidrawAssets, state: { kind: 'drawn', rendered, url } });
      read.current?.(rendered.drawing, { blocked: rendered.blocked });
    }, (error: unknown) => {
      if (abort.signal.aborted) return;
      setOutcome({ text, format, assets: excalidrawAssets, state: { kind: 'error', reason: error instanceof DrawingError ? error.reason : 'renderer' } });
    });
    return () => abort.abort();
  }, [format, text, excalidrawAssets]);
  return <section data-boring="drawing-viewer" data-state={state.kind} data-format={format} data-blocked={state.kind === 'drawn' ? state.rendered.blocked.length : undefined} aria-label={title ?? labels.kind} aria-busy={state.kind === 'loading' || undefined}
    className="flex w-full min-w-0 flex-col gap-3 px-3 pt-2 pb-4 sm:px-6">
    {state.kind === 'loading' && <p role="status" className="m-0 flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Spinner />{labels.loading}</p>}
    {state.kind === 'error' && <Alert variant="destructive" data-testid="drawing-error" data-reason={state.reason}><TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{labels.errorTitle}</AlertTitle><AlertDescription>{labels.error(state.reason)}</AlertDescription></Alert>}
    {state.kind === 'drawn' && <figure className="m-0 min-w-0 overflow-auto bg-muted p-2">
      <img data-testid="drawing-image" src={state.url} width={Math.round(state.rendered.width) || undefined} height={Math.round(state.rendered.height) || undefined}
        alt={labels.image(state.rendered.drawing.format, state.rendered.drawing.shapes.length, state.rendered.drawing.arrows.length)}
        className="mx-auto block h-auto max-w-full" draggable={false} />
    </figure>}
  </section>;
}
