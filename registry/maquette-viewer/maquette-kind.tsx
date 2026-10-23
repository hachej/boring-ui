'use client';

import { lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { LayoutTemplateIcon } from 'lucide-react';
import { isMaquettePath } from './maquette';
import { maquetteLabelsFor } from './maquette-labels';
import type { MaquetteLabels, MaquetteLocale } from './maquette-labels';
import type { MaquetteComments, MaquetteMenuEntry, MaquetteRead } from './maquette-viewer';

// The viewer loads only when a maquette opens: this module (match, label, icon) is all a host's first paint carries.
const MaquetteViewer = lazy(() => import('./maquette-viewer').then(module => ({ default: module.MaquetteViewer })));

/**
 * The artifact kind of a maquette file (structurally an `ArtifactKind` of pi-artifacts): it matches `*.maquette.json`, names it, gives its icon
 * and draws it with `MaquetteViewer`, loaded on first open. Pass it, or your own, in `artifactKinds`; kinds an app passes are consulted first.
 */
export interface MaquetteKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: {
    readonly text: string; readonly fragment?: string | undefined;
    readonly artifact?: { readonly target: { readonly resource: { readonly path: string } } } | undefined; readonly read?: MaquetteRead | undefined;
    readonly setMenu?: ((items: readonly MaquetteMenuEntry[]) => void) | undefined;
  }) => ReactNode;
}

/**
 * A maquette kind in `locale` ("Mock-up" in English, "Maquette" in French) with any word overridden. `comments` (the feedback item's
 * `usePointComments(session)`) adds the comment icon; pass a fresh kind when it changes.
 */
export function createMaquetteKind({ locale, labels, comments }: {
  readonly locale?: MaquetteLocale | undefined; readonly labels?: Partial<MaquetteLabels> | undefined; readonly comments?: MaquetteComments | undefined;
} = {}): MaquetteKind {
  return {
    match: target => isMaquettePath(target.resource.path),
    label: maquetteLabelsFor(locale, labels).kind,
    icon: LayoutTemplateIcon,
    renderer: ({ text, fragment, artifact, read, setMenu }) => <MaquetteViewer text={text} fragment={fragment} locale={locale} labels={labels}
      path={artifact?.target.resource.path} comments={comments} read={read} publishMenu={setMenu} />,
  };
}

/** The built-in maquette kind, in English. */
export const maquetteKind: MaquetteKind = createMaquetteKind();
