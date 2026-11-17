import type { ComponentType } from 'react';
import type { CodeViewProps } from './svg-view';
import { isHighlighted } from './highlight';

/**
 * The code kinds (D-257): an SVG artifact (preview from a blob URL, or its source) and a CSV artifact (a table). Both draw inside the
 * panel's viewer bar, with its copy and download. This module is cheap; each view loads the first time its artifact opens. A source file (TypeScript, JavaScript, Python, shell, JSON) is drawn with its syntax coloured and its lines numbered (`codeKind`, no highlighter dependency).
 * Other text stays in the panel's own code block.
 */
export interface CodeKind {
  readonly match: (target: { readonly resource: { readonly path: string } }, artifact: { readonly type: string; readonly language?: string | undefined }) => boolean;
  readonly label?: string | undefined;
  /** A default viewer for a type: a host's `viewers.svg` or `viewers.code` wins over it. */
  readonly fallback: true;
  readonly load: () => Promise<{ readonly default: ComponentType<CodeViewProps> }>;
}

export const svgKind: CodeKind = {
  match: (_target, artifact) => artifact.type === 'svg',
  fallback: true,
  load: () => import('./svg-view').then(module => ({ default: module.SvgView })),
};

export const csvKind: CodeKind = {
  match: (_target, artifact) => artifact.type === 'code' && artifact.language === 'csv',
  fallback: true,
  load: () => import('./csv-table').then(module => ({ default: module.CsvView })),
};

/** Source code in a language `highlight.ts` knows: coloured and numbered, display only. */
export const codeKind: CodeKind = {
  match: (_target, artifact) => artifact.type === 'code' && isHighlighted(artifact.language),
  fallback: true,
  load: () => import('./code-view').then(module => ({ default: module.CodeView })),
};
