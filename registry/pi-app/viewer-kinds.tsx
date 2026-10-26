'use client';

// What a kind is to the artifact panel and the file viewer (D-257): an app's `ArtifactKind`, or a document kind (Markdown and HTML edited
// over a revisioned controller; image and PDF read as bytes). These are contracts only: the kinds themselves come from the host, through
// `AgentWorkspace`'s `artifactKinds` or `ViewerOptions.kinds`. The pi-app-kinds item exports the default list (`defaultKinds`), whose
// kinds (the viewer items' `markdownKind`, `imageKind`...) satisfy these types structurally; none of the viewers is in this item.
import { lazy, useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import type { MarkdownEditorProps } from '@hachej/boring-ui-kit/markdown-editor';
import type { ArtifactKind, ArtifactKindViewProps } from '../pi-artifacts/artifact';
import type { ViewerShare } from '../viewer-frame/viewer-frame';
import type { InteractiveHtml } from '../viewer-frame/interactive-html';
import type { MediaSource } from '../viewer-frame/media';

/** The viewer bar's props the panel and the file viewer give every pane a document or media kind loads. */
export interface PaneBarProps {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly target?: unknown;
  readonly revision?: string;
  readonly headerStart?: ReactNode;
  readonly controls?: ReactNode;
  readonly onRefresh?: () => unknown;
  readonly onShare?: ViewerShare;
  readonly onClose?: () => unknown;
  readonly testId?: string;
  readonly titleTestId?: string;
}

/** What a Markdown kind's pane receives (the viewer-markdown item's `MarkdownPane` takes these and more). */
export interface MarkdownPaneInput extends PaneBarProps {
  readonly controller: MarkdownController;
  readonly initialMode?: 'rich' | 'source';
  readonly onModeChange?: (mode: 'rich' | 'source') => void;
  readonly formattingToolbar?: MarkdownEditorProps['formattingToolbar'];
  readonly onFormattingToolbarChange?: (toolbar: 'selection' | 'pinned') => void;
  readonly onAutosaveChange?: MarkdownEditorProps['onAutosaveChange'];
  readonly onBeforeLeaveChange?: MarkdownEditorProps['onAutosaveChange'];
}

/** What an HTML kind's pane receives (the viewer-html item's `HtmlPane`). */
export interface HtmlPaneInput extends PaneBarProps {
  readonly controller: HtmlController;
  readonly initialMode?: 'preview' | 'source';
  readonly onModeChange?: (mode: 'preview' | 'source') => void;
  readonly interactive?: InteractiveHtml;
}

/** What an image kind's pane receives (the viewer-image item's `ImagePane`): the bytes, a blob or the host's URL of a large file. */
export interface ImagePaneInput extends PaneBarProps, MediaSource { readonly name: string; readonly mediaType: string }

/** What a PDF kind's pane receives (the viewer-pdf item's `PdfPane`). */
export interface PdfPaneInput extends PaneBarProps, MediaSource { readonly name: string }

/** What a code kind's view receives (the viewer-code item's SVG and CSV views): of the panel's kind props, these. */
export interface CodeViewInput {
  readonly text: string;
  readonly artifact: { readonly title: string };
  readonly setControls?: ((controls: ReactNode) => void) | undefined;
}

type KindHead = Pick<ArtifactKind, 'match' | 'label' | 'icon' | 'fallback'>;
type Loads<Props> = { readonly load: () => Promise<{ readonly default: ComponentType<Props> }> };

/** A kind drawn by a view of the panel's text that reads fewer props than an `ArtifactKind` view (SVG, CSV). */
export type CodeKind = KindHead & Loads<CodeViewInput>;
/** A document kind edited over a revisioned controller (Markdown, HTML): the panel and the file viewer create the controller. */
export type EditorKind = KindHead & ((Loads<MarkdownPaneInput> & { readonly editor: 'markdown' }) | (Loads<HtmlPaneInput> & { readonly editor: 'html' }));
/** A kind that reads a file's bytes rather than its text (image, PDF): the file viewer draws it. */
export type MediaKind = KindHead & ((Loads<ImagePaneInput> & { readonly media: 'image' }) | (Loads<PdfPaneInput> & { readonly media: 'pdf' }));
/** Any kind the panel and the file viewer take: an app's `ArtifactKind`, a code kind, an editor kind or a media kind. */
export type PanelKind = ArtifactKind | CodeKind | EditorKind | MediaKind;

/** What the panel and the file viewer resolve through when the host passes no kinds: none, so every file shows as text. */
export const noKinds: readonly PanelKind[] = [];

export const isEditorKind = (kind: PanelKind | undefined): kind is EditorKind => !!kind && 'editor' in kind;
export const isMediaKind = (kind: PanelKind | undefined): kind is MediaKind => !!kind && 'media' in kind;

/** A kind that draws an artifact's text in the panel: an editor kind, or one with a renderer or a lazily loaded view (not image or PDF). */
export const drawsText = (kind: PanelKind): boolean => !isMediaKind(kind) && (isEditorKind(kind) || ('renderer' in kind && !!kind.renderer) || !!kind.load);

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
