'use client';

import { useState } from 'react';
import { HistoryIcon } from 'lucide-react';
import type { SavedRevision } from '@hachej/boring-files/revision';
import { ActionMenu } from '../button/actions';
import type { ActionMenuProps, MenuItem } from '../button/actions';
import { useViewerText } from './viewer-window';
import type { ViewerLabels } from './viewer-window';

export type ViewerMenuItem = MenuItem;
export type ViewerMenuProps = Omit<ActionMenuProps, 'size'>;

/** The consumer's shadcn Base UI dropdown supplies positioning, dismissal and keyboard navigation. */
export function ViewerMenu({ testId = 'viewer-menu', ...props }: ViewerMenuProps) {
  return <ActionMenu {...props} testId={testId} />;
}

export interface ViewerVersion {
  readonly id: string;
  readonly label: string;
  readonly latest?: boolean;
  readonly savedAt?: number;
  readonly source?: SavedRevision['source'];
  /** Only shown when the host has measured the change. Never inferred from a revision id. */
  readonly changeSummary?: string;
}

function dayLabel(time: number, now: number, labels: ViewerLabels): string {
  const date = new Date(time), today = new Date(now), yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === today.toDateString() ? labels.versionToday
    : date.toDateString() === yesterday.toDateString() ? labels.versionYesterday
    : date.toLocaleDateString();
}

function relativeTime(time: number, now: number, labels: ViewerLabels): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return labels.versionJustNow;
  if (minutes < 60) return labels.versionMinutesAgo(minutes);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (new Date(time).toDateString() === yesterday.toDateString()) return labels.versionYesterdayAt(new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
  if (minutes < 1440) return labels.versionHoursAgo(Math.floor(minutes / 60));
  return new Date(time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
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
  return <ViewerMenu label={label ?? labels.versionHistory} testId={testId} align="end" icon={<HistoryIcon data-icon="inline-start" aria-hidden="true" />} onOpenChange={open => { if (open) setNow(Date.now()); }}
    items={versions.map(version => {
      const author = version.source === 'publish' ? labels.versionYou : version.source === 'agent' ? labels.versionAgent : version.source === 'observed' ? labels.versionObserved : labels.versionUnknownAuthor;
      return { id: version.id, label: version.savedAt ? relativeTime(version.savedAt, now, labels) : version.label,
        description: version.changeSummary ? `${author} · ${version.changeSummary}` : author,
        ...(version.savedAt ? { group: dayLabel(version.savedAt, now, labels) } : {}),
        ...(version.id === current ? { hint: labels.currentVersion } : {}), checked: version.id === current,
        testId: `${testId}-item`, onSelect: () => onSelect(version.id) };
    })} />;
}
