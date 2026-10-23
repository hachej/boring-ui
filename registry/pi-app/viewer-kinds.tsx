'use client';

// The kinds the artifact panel and the file viewer resolve through (D-257): the domain kinds (maquette, diagram, mock-up, records) and the
// document kinds (Markdown, HTML, SVG, CSV, image, PDF). Each kind module is cheap (match, label, icon, loader); its view is loaded the
// first time an artifact of that kind opens, so none of the viewers (tiptap, pdf.js, the maquette...) is in the page's first bundle.
import { lazy, useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { ArtifactKind, ArtifactKindViewProps } from '../pi-artifacts/artifact';
import { maquetteKind } from '../maquette-viewer/maquette-kind';
import { diagramKind } from '../diagram-viewer/diagram-kind';
import { mockupKind } from '../mockup-viewer/mockup-kind';
import { recordsKind } from '../record-viewer/records-kind';
import { markdownKind } from '../viewer-markdown/markdown-kind';
import type { MarkdownKind } from '../viewer-markdown/markdown-kind';
import { htmlKind } from '../viewer-html/html-kind';
import type { HtmlKind } from '../viewer-html/html-kind';
import { csvKind, svgKind } from '../viewer-code/code-kinds';
import type { CodeKind } from '../viewer-code/code-kinds';
import { imageKind } from '../viewer-image/image-kind';
import type { ImageKind } from '../viewer-image/image-kind';
import { pdfKind } from '../viewer-pdf/pdf-kind';
import type { PdfKind } from '../viewer-pdf/pdf-kind';

/** Any kind the panel and the file viewer take: an app's `ArtifactKind`, or a built-in document kind. */
export type PanelKind = ArtifactKind | MarkdownKind | HtmlKind | CodeKind | ImageKind | PdfKind;
/** A document kind edited over a revisioned controller (Markdown, HTML). */
export type EditorKind = MarkdownKind | HtmlKind;
/** A kind that reads a file's bytes rather than its text (image, PDF): the file viewer draws it. */
export type MediaKind = ImageKind | PdfKind;

export const isEditorKind = (kind: PanelKind | undefined): kind is EditorKind => !!kind && 'editor' in kind;
export const isMediaKind = (kind: PanelKind | undefined): kind is MediaKind => !!kind && 'media' in kind;

/** A kind that draws an artifact's text in the panel: an editor kind, or one with a renderer or a lazily loaded view (not image or PDF). */
export const drawsText = (kind: PanelKind): boolean => !isMediaKind(kind) && (isEditorKind(kind) || ('renderer' in kind && !!kind.renderer) || !!kind.load);

/** The built-in document kinds: each is a host's default for its type, so a `viewers` entry for that type wins over it. */
export const documentKinds: readonly PanelKind[] = [markdownKind, htmlKind, svgKind, csvKind, imageKind, pdfKind];

/**
 * Every built-in kind, in English: the domain kinds, then the document kinds. `ViewerOptions.kinds` defaults to it; a host passing its own
 * list puts its kinds first and spreads this after them (`AgentWorkspace` does, in the workspace's language).
 */
export const viewerKinds: readonly PanelKind[] = [maquetteKind, diagramKind, mockupKind, recordsKind, ...documentKinds];

// One lazy component per loader, for the life of the page: a kind recreated on each render (a fresh comments object) keeps its loader
// identity when it is a module constant, and a loader seen again never re-suspends.
const views = new WeakMap<object, unknown>();

/** The `React.lazy` component of a kind's `load`, created once per loader. */
export function lazyView<Props>(load: () => Promise<{ readonly default: ComponentType<Props> }>): ComponentType<Props> {
  let view = views.get(load) as ComponentType<Props> | undefined;
  if (!view) { view = lazy(load) as unknown as ComponentType<Props>; views.set(load, view); }
  return view;
}

const renderers = new WeakMap<object, (props: ArtifactKindViewProps) => ReactNode>();

/** A kind's `load` as a renderer (one per loader): the panel draws it like a kind's own `renderer`, inside its `Suspense`. */
// A view takes the panel's props or fewer of them (the code views read only `text`, `artifact` and `setControls`).
export function lazyRenderer(load: () => Promise<{ readonly default: unknown }>): (props: ArtifactKindViewProps) => ReactNode {
  let render = renderers.get(load);
  if (!render) { const View = lazyView(load as () => Promise<{ readonly default: ComponentType<ArtifactKindViewProps> }>); render = props => <View {...props} />; renderers.set(load, render); }
  return render;
}

/** The spinner a viewer bar shows while its view loads. */
export function ViewLoading({ label }: { readonly label: string }) {
  return <p data-testid="viewer-loading" role="status" aria-label={label} className="m-0 flex flex-1 items-center justify-center p-6 text-muted-foreground">
    <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
  </p>;
}

/** Calls `onMount(value)` once it commits: inside a `Suspense`, that is only after the lazy view beside it has loaded and mounted. */
export function Mounted({ value, onMount }: { readonly value: string; readonly onMount: (value: string) => void }) {
  useEffect(() => { onMount(value); }, [value, onMount]);
  return null;
}
