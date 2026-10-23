'use client';

import { lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { PaletteIcon } from 'lucide-react';
import { isLooksPath } from './looks';
import type { LookPick } from './looks-viewer';

const LooksViewer = lazy(() => import('./looks-viewer').then(module => ({ default: module.LooksViewer })));

export interface LooksKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: { readonly text: string; readonly onReady?: (() => void) | undefined; readonly onFailed?: ((reason: string) => void) | undefined; readonly read?: ((path: string) => Promise<string | undefined>) | undefined; readonly artifact?: { readonly target: { readonly resource: { readonly path: string } } } | undefined }) => ReactNode;
  readonly waitsForReady: true;
}

/** The `*.looks.json` kind: opt-in, like the board. `onPick` is the host's (the PM page says the pick in the conversation). The viewer loads on first open. */
export function createLooksKind({ onPick, locale }: { readonly onPick?: ((pick: LookPick) => void) | undefined; readonly locale?: 'en' | 'fr' | undefined } = {}): LooksKind {
  return { match: target => isLooksPath(target.resource.path), label: locale === 'fr' ? 'Styles' : 'Looks', icon: PaletteIcon, waitsForReady: true,
    renderer: ({ text, artifact, read, onReady, onFailed }) => <LooksViewer key={artifact?.target.resource.path} text={text} path={artifact?.target.resource.path} read={read} onPick={onPick} locale={locale} onReady={onReady} onFailed={onFailed} /> };
}
