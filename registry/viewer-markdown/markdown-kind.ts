import type { ComponentType } from 'react';
import type { MarkdownPaneProps } from './markdown-pane';

/**
 * The Markdown kind (D-257): Markdown artifacts and `.md` files, edited by `MarkdownPane` (tiptap) over the panel's revisioned
 * controller. This module is cheap; the editor and tiptap load the first time a Markdown file opens.
 */
export interface MarkdownKind {
  readonly match: (target: { readonly resource: { readonly path: string } }, artifact: { readonly type: string }) => boolean;
  readonly label?: string | undefined;
  /** A default viewer for a type: a host's `viewers.markdown` wins over it. */
  readonly fallback: true;
  /** The panel and the file viewer create a Markdown controller over the file and hand it to the pane. */
  readonly editor: 'markdown';
  readonly load: () => Promise<{ readonly default: ComponentType<MarkdownPaneProps> }>;
}

export const markdownKind: MarkdownKind = {
  match: (_target, artifact) => artifact.type === 'markdown',
  fallback: true, editor: 'markdown',
  load: () => import('./markdown-pane').then(module => ({ default: module.MarkdownPane })),
};
