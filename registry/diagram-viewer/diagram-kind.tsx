'use client';

import { lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { WorkflowIcon } from 'lucide-react';
import { isDiagramPath } from './diagram';
import { diagramLabelsFor } from './diagram-labels';
import type { DiagramLabels, DiagramLocale } from './diagram-labels';

const DiagramViewer = lazy(() => import('./diagram-viewer').then(module => ({ default: module.DiagramViewer })));

/**
 * The artifact kind of a diagram file (structurally an `ArtifactKind` of pi-artifacts): it matches `*.diagram.json`, names it, gives its icon
 * and draws it with `DiagramViewer`, loaded on first open. It is in the pi-app-kinds default list (`defaultKinds`); kinds in `artifactKinds` are consulted in order.
 */
export interface DiagramKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: { readonly text: string }) => ReactNode;
}

/** A diagram kind in `locale` ("Diagram" in English, "Diagramme" in French) with any word overridden. */
export function createDiagramKind({ locale, labels }: { readonly locale?: DiagramLocale | undefined; readonly labels?: Partial<DiagramLabels> | undefined } = {}): DiagramKind {
  return {
    match: target => isDiagramPath(target.resource.path),
    label: diagramLabelsFor(locale, labels).kind,
    icon: WorkflowIcon,
    renderer: ({ text }) => <DiagramViewer text={text} locale={locale} labels={labels} />,
  };
}

/** The built-in diagram kind, in English. */
export const diagramKind: DiagramKind = createDiagramKind();
