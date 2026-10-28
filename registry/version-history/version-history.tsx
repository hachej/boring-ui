'use client';

import type { SavedRevision } from '@hachej/boring-files/revision';
import { Button } from '@/components/ui/button';
import { ActionMenuItemContent } from '../button/actions';
import type { MenuItem } from '../button/actions';

export const defaultVersionHistoryLabels = {
  versionHistory: 'Version history',
  currentVersion: 'Current',
  versionYou: 'You',
  versionAgent: 'Agent',
  versionObserved: 'External change',
  versionUnknownAuthor: 'Saved version',
  versionJustNow: 'Just now',
  versionMinutesAgo: (count: number) => `${count} min ago`,
  versionHoursAgo: (count: number) => `${count} h ago`,
  versionYesterdayAt: (time: string) => `Yesterday ${time}`,
  versionToday: 'Today',
  versionYesterday: 'Yesterday',
};
export type VersionHistoryLabels = typeof defaultVersionHistoryLabels;
export const frenchVersionHistoryLabels: VersionHistoryLabels = {
  versionHistory: 'Historique des versions',
  currentVersion: 'Actuelle',
  versionYou: 'Vous',
  versionAgent: 'Agent',
  versionObserved: 'Modification externe',
  versionUnknownAuthor: 'Version enregistrée',
  versionJustNow: 'À l’instant',
  versionMinutesAgo: count => `Il y a ${count} min`,
  versionHoursAgo: count => `Il y a ${count} h`,
  versionYesterdayAt: time => `Hier ${time}`,
  versionToday: 'Aujourd’hui',
  versionYesterday: 'Hier',
};

export interface VersionHistoryEntry {
  readonly id: string;
  readonly label: string;
  readonly latest?: boolean;
  readonly savedAt?: number;
  readonly source?: SavedRevision['source'];
  /** Only shown when the host has measured the change. Never inferred from a revision id. */
  readonly changeSummary?: string;
}

function dayLabel(time: number, now: number, labels: VersionHistoryLabels): string {
  const date = new Date(time), today = new Date(now), yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === today.toDateString() ? labels.versionToday
    : date.toDateString() === yesterday.toDateString() ? labels.versionYesterday
    : date.toLocaleDateString();
}

function relativeTime(time: number, now: number, labels: VersionHistoryLabels): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return labels.versionJustNow;
  if (minutes < 60) return labels.versionMinutesAgo(minutes);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (new Date(time).toDateString() === yesterday.toDateString()) return labels.versionYesterdayAt(new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
  if (minutes < 1440) return labels.versionHoursAgo(Math.floor(minutes / 60));
  return new Date(time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Current is the displayed revision, not necessarily the latest one. Shared by menus and inline rows. */
export function versionHistoryItems({ versions, current, onSelect, labels, now, testId }: {
  readonly versions: readonly VersionHistoryEntry[];
  readonly current: string;
  readonly onSelect: (id: string) => void;
  readonly labels: VersionHistoryLabels;
  readonly now: number;
  readonly testId: string;
}): readonly MenuItem[] {
  return versions.map(version => {
    const author = version.source === 'publish' ? labels.versionYou : version.source === 'agent' ? labels.versionAgent : version.source === 'observed' ? labels.versionObserved : labels.versionUnknownAuthor;
    return { id: version.id, label: version.savedAt !== undefined ? relativeTime(version.savedAt, now, labels) : version.label,
      description: version.changeSummary ? `${author} · ${version.changeSummary}` : author,
      ...(version.savedAt !== undefined ? { group: dayLabel(version.savedAt, now, labels) } : {}),
      ...(version.id === current ? { hint: labels.currentVersion } : {}), checked: version.id === current,
      testId: `${testId}-item`, onSelect: () => onSelect(version.id) };
  });
}

/** Inline form of the viewer menu's rows. The consumer's shadcn Button owns each selection control. */
export function VersionHistoryRows({ versions, current, onSelect, labels: given, testId = 'version-history' }: {
  readonly versions: readonly VersionHistoryEntry[];
  readonly current: string;
  readonly onSelect: (id: string) => void;
  readonly labels?: Partial<VersionHistoryLabels>;
  readonly testId?: string;
}) {
  const labels = { ...defaultVersionHistoryLabels, ...given };
  // eslint-disable-next-line react-hooks/purity -- relative times ("2 min ago") read the clock each render on purpose
  const items = versionHistoryItems({ versions, current, onSelect, labels, now: Date.now(), testId });
  return <ul data-boring="version-history" className="m-0 list-none p-0">
    {items.map((item, index) => <li key={item.id}>
      {item.group && item.group !== items[index - 1]?.group && <p className="px-2 pt-3 pb-1 text-xs text-muted-foreground">{item.group}</p>}
      <Button type="button" variant="ghost" aria-pressed={item.checked} data-item={item.id} data-testid={item.testId} onClick={item.onSelect} className="h-auto min-h-11 w-full justify-start gap-2 text-left">
        <ActionMenuItemContent item={item} testId={testId} />
      </Button>
    </li>)}
  </ul>;
}
