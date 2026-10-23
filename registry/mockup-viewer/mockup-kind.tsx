'use client';

import { lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { CodeXmlIcon } from 'lucide-react';
import { isMockupPath } from './mockup-path';
import type { MockupComments } from './mockup-viewer';

const MockupViewer = lazy(() => import('./mockup-viewer').then(module => ({ default: module.MockupViewer })));

export interface MockupKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: { readonly text: string; readonly onReady?: (() => void) | undefined; readonly artifact?: { readonly target: { readonly resource: { readonly path: string } } } | undefined }) => ReactNode;
  /** The sandboxed frame loads asynchronously: a `present` of a mock-up is confirmed only once it has loaded. */
  readonly waitsForReady: true;
}

/** The `*.mockup.html` kind; the viewer (and its Tailwind compiler) loads on first open. */
export function createMockupKind({ comments, locale }: { readonly comments?: MockupComments | undefined; readonly locale?: 'en' | 'fr' | undefined } = {}): MockupKind {
  return { match: target => isMockupPath(target.resource.path), label: locale === 'fr' ? 'Maquette HTML' : 'HTML mock-up', icon: CodeXmlIcon, waitsForReady: true,
    renderer: ({ text, artifact, onReady }) => <MockupViewer key={artifact?.target.resource.path} text={text} path={artifact?.target.resource.path} comments={comments} locale={locale} onReady={onReady} /> };
}
export const mockupKind: MockupKind = createMockupKind();
