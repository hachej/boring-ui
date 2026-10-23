import type { ComponentType } from 'react';
import type { HtmlPaneProps } from './html-pane';

/**
 * The HTML kind (D-257): HTML artifacts and `.html` files, shown by `HtmlPane` (passive preview and source editor) over the panel's
 * revisioned controller. This module is cheap; the pane loads the first time an HTML file opens.
 */
export interface HtmlKind {
  readonly match: (target: { readonly resource: { readonly path: string } }, artifact: { readonly type: string }) => boolean;
  readonly label?: string | undefined;
  readonly fallback: true;
  readonly editor: 'html';
  readonly load: () => Promise<{ readonly default: ComponentType<HtmlPaneProps> }>;
}

export const htmlKind: HtmlKind = {
  match: (_target, artifact) => artifact.type === 'html',
  fallback: true, editor: 'html',
  load: () => import('./html-pane').then(module => ({ default: module.HtmlPane })),
};
