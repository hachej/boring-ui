/*
 * The window a viewer sits in, and the viewers' words and icons as plain data. A host passes a partial `labels` (and `icons`) object to
 * `ViewerWindowProvider` (every viewer below reads it) or to one `ViewerFrame`; what it leaves out keeps the default below.
 */
import { createContext, useContext, useMemo } from 'react';
import { EllipsisIcon, Maximize2Icon, Minimize2Icon, Share2Icon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MarkdownEditorProps } from '@hachej/boring-ui-kit/markdown-editor';
import type { BlockAction, BlockIcon } from '../button/actions';
import { withDefaults } from '../utils/utils';
import { defaultVersionHistoryLabels } from '../version-history/version-history';

export const defaultViewerLabels = {
  share: 'Share',
  moreActions: 'More actions',
  reload: 'Reload',
  copy: 'Copy',
  download: 'Download',
  openInNewTab: 'Open in new tab',
  enterFullscreen: 'Enter full screen',
  exitFullscreen: 'Exit full screen',
  close: 'Close',
  readOnly: 'Read-only',
  refreshFailed: 'Refresh failed',
  shareFailed: 'Could not share',
  linkCopied: 'Link copied',
  shared: 'Shared',
  copied: 'Copied',
  copyFailed: 'Could not copy',
  actionFailed: 'The action failed',
  /** Shown when the browser allowed no automatic copy: `link` is true for Share, false for Copy. */
  manualCopy: (link: boolean) => `This browser blocked automatic copying. Copy the ${link ? 'link' : 'text'} below.`,
  done: 'Done',
  ...defaultVersionHistoryLabels,
  versionViewOnly: 'Viewing an older version. Restore is not available in this viewer.',
  latest: 'Latest',
  loading: 'Loading…',
  // Save status
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  saveUnconfirmed: 'Save unconfirmed',
  changedElsewhere: 'Changed elsewhere',
  closed: 'Closed',
  save: 'Save',
  checkSave: 'Check save outcome',
  abandon: 'Abandon and refresh, keeping my draft',
  discardLocal: 'Discard local edits',
  // Modes
  view: 'View',
  preview: 'Preview',
  source: 'Source',
  htmlPreview: 'HTML preview',
  htmlSource: 'HTML source',
  editorMode: 'Editor mode',
  rich: 'Rich',
  richText: 'Rich text',
  markdownSource: 'Markdown source',
  document: 'Document',
  // Images and PDFs
  zoom: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomLevel: (percent: string) => `Zoom ${percent}, fit to view`,
  fitToView: 'Fit to view',
  actualSize: 'Actual size',
  imageUnreadable: 'This file could not be read as an image.',
  imageUnsupported: (mediaType: string) => `This image type (${mediaType || 'unknown'}) cannot be shown here. You can still download it.`,
  imageStage: (name: string) => `${name} image`,
  pdfUnsupported: 'This browser cannot show PDFs inline.',
  pdfDocument: (name: string) => `${name} pages`,
  /** The page indicator of the drawn pages, for example `3 / 12`. */
  pdfPage: (current: number, count: number) => `${current} / ${count}`,
  pdfHint: (name: string, canOpen: boolean) => `Download ${name} to read it in a PDF app${canOpen ? ', or open it in a new tab' : ''}.`,
  notSaved: (reason: string) => `Not saved: ${reason}`,
  saveFailedReason: 'the save failed',
  changedElsewhereReason: 'changed elsewhere',
  operationFailed: 'The document operation failed. Your source has been retained.',
};
export type ViewerLabels = typeof defaultViewerLabels;

export const defaultViewerIcons = {
  share: Share2Icon as BlockIcon,
  more: EllipsisIcon as BlockIcon,
  close: XIcon as BlockIcon,
  enterFullscreen: Maximize2Icon as BlockIcon,
  exitFullscreen: Minimize2Icon as BlockIcon,
};
export type ViewerIcons = typeof defaultViewerIcons;

/**
 * The window a viewer sits in, when the host lays viewers out in a panel (pi-app's `AgentWorkspace`, the ambient window). With
 * `onFullscreenChange`, every `ViewerFrame` below shows an "Enter full screen" / "Exit full screen" button; `actions` adds the host's
 * actions to every viewer bar (`header` ones as buttons, `menu` ones in its "…" menu, test ids `<frame testId>-<id>`); `labels` and
 * `icons` reach every viewer below. Without a provider nothing changes.
 */
export interface ViewerWindow {
  /** Markdown autosave policy for every pane below. Defaults to true, with a 1200ms idle delay. */
  readonly autosave?: MarkdownEditorProps['autosave'];
  /** Place the existing bar in a host-owned shared header (for example with createPortal). Default: above the viewer body. */
  readonly renderHeader?: ((header: ReactNode) => ReactNode) | undefined;
  /** `stacked` keeps the title and window actions above a separate content toolbar. Default: `inline`, one row. */
  readonly headerLayout?: 'inline' | 'stacked' | undefined;
  readonly fullscreen?: boolean | undefined;
  readonly onFullscreenChange?: ((next: boolean) => void) | undefined;
  readonly actions?: readonly BlockAction[] | undefined;
  readonly labels?: Partial<ViewerLabels> | undefined;
  readonly icons?: Partial<ViewerIcons> | undefined;
}
const ViewerWindowContext = createContext<ViewerWindow | undefined>(undefined);
export const ViewerWindowProvider = ViewerWindowContext.Provider;
export const useViewerWindow = (): ViewerWindow | undefined => useContext(ViewerWindowContext);

/** The viewers' labels and icons: the defaults, then the window's, then the frame's own. */
export function useViewerText(labels?: Partial<ViewerLabels>, icons?: Partial<ViewerIcons>): { readonly labels: ViewerLabels; readonly icons: ViewerIcons } {
  const host = useViewerWindow();
  return useMemo(() => ({ labels: withDefaults(defaultViewerLabels, host?.labels, labels), icons: withDefaults(defaultViewerIcons, host?.icons, icons) }), [host?.labels, host?.icons, labels, icons]);
}
