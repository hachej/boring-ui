'use client';

import { lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Rows3Icon } from 'lucide-react';
import { isRecordsPath } from './records';
import { recordsLabelsFor } from './records-labels';
import type { RecordTableProps, Words } from './record-viewer';

const RecordsViewer = lazy(() => import('./record-viewer').then(module => ({ default: module.RecordsViewer })));

export interface RecordsKind {
  readonly match: (target: { readonly resource: { readonly path: string } }) => boolean;
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }>;
  readonly renderer: (props: { readonly text: string }) => ReactNode;
}
/** The `*.records.json` kind; the viewer loads on first open. */
export function createRecordsKind(options: Words & { readonly onAction?: RecordTableProps['onAction'] } = {}): RecordsKind {
  return { match: target => isRecordsPath(target.resource.path), label: recordsLabelsFor(options.locale, options.labels).kind, icon: Rows3Icon,
    renderer: ({ text }) => <RecordsViewer text={text} {...options} /> };
}
export const recordsKind: RecordsKind = createRecordsKind();
