'use client';

import { useState } from 'react';
import { HistoryIcon } from 'lucide-react';
import { ActionMenu } from '../button/actions';
import type { ActionMenuProps, MenuItem } from '../button/actions';
import { versionHistoryItems } from '../version-history/version-history';
import type { VersionHistoryEntry } from '../version-history/version-history';
import { useViewerText } from './viewer-window';

export type ViewerMenuItem = MenuItem;
export type ViewerMenuProps = Omit<ActionMenuProps, 'size'>;
export type ViewerVersion = VersionHistoryEntry;

/** The consumer's shadcn Base UI dropdown supplies positioning, dismissal and keyboard navigation. */
export function ViewerMenu({ testId = 'viewer-menu', ...props }: ViewerMenuProps) {
  return <ActionMenu {...props} testId={testId} />;
}

/** Saved versions are view-only choices. Current is the displayed revision, not necessarily the latest one. */
export function ViewerVersions({ versions, current, onSelect, testId = 'viewer-versions', label }: {
  readonly versions: readonly ViewerVersion[];
  readonly current: string;
  readonly onSelect: (id: string) => void;
  readonly testId?: string;
  readonly label?: string;
}) {
  const { labels } = useViewerText();
  const [now, setNow] = useState(Date.now);
  return <ViewerMenu label={label ?? labels.versionHistory} testId={testId} align="end" icon={<HistoryIcon className="size-4" aria-hidden="true" />} onOpenChange={open => { if (open) setNow(Date.now()); }}
    items={versionHistoryItems({ versions, current, onSelect, labels, now, testId })} />;
}
