'use client';

import { HistoryIcon } from 'lucide-react';
import { ActionMenu } from '../button/actions';
import type { ActionMenuProps, MenuItem } from '../button/actions';
import { useViewerText } from './viewer-window';

/** One row of a viewer menu. With `checked` set (true or false) the row is a radio choice, otherwise a plain action. */
export type ViewerMenuItem = MenuItem;
export type ViewerMenuProps = Omit<ActionMenuProps, 'size'>;

/**
 * An icon button that opens a small menu (the shared `ActionMenu` of the button item): arrow keys, Home/End and roving focus, Escape
 * (focus returns to the trigger), Tab and an outside press close it. Used for the viewer's overflow actions and the version history.
 */
export function ViewerMenu({ testId = 'viewer-menu', ...props }: ViewerMenuProps) {
  return <ActionMenu testId={testId} {...props} />;
}

/** One saved version in a history menu. */
export interface ViewerVersion { readonly id: string; readonly label: string; readonly latest?: boolean }

/**
 * The version history of a document: an icon button (tooltip "Version history") that opens the list of versions, newest first, with the
 * latest marked and the one on display checked.
 */
export function ViewerVersions({ versions, current, onSelect, testId = 'viewer-versions', label, latest }: {
  readonly versions: readonly ViewerVersion[];
  readonly current: string;
  readonly onSelect: (id: string) => void;
  readonly testId?: string;
  readonly label?: string;
  /** The hint on the newest version. */
  readonly latest?: string;
}) {
  const { labels } = useViewerText();
  return <ViewerMenu label={label ?? labels.versionHistory} testId={testId} align="end" icon={<HistoryIcon className="size-4" aria-hidden="true" />}
    items={versions.map(version => ({ id: version.id, label: version.label, ...(version.latest ? { hint: latest ?? labels.latest } : {}), checked: version.id === current, testId: `${testId}-item`, onSelect: () => onSelect(version.id) }))} />;
}
