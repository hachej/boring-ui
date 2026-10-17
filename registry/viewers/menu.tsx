'use client';

import { useState } from 'react';
import { HistoryIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ActionMenuContent, useMenuPortal } from '../button/actions';
import type { MenuItem } from '../button/actions';
import { versionHistoryItems } from '../version-history/version-history';
import type { VersionHistoryEntry } from '../version-history/version-history';
import { useViewerText } from './viewer-window';

export type ViewerMenuItem = MenuItem;
export interface ViewerMenuProps {
  readonly label: string;
  readonly icon: ReactNode;
  readonly items: readonly MenuItem[];
  readonly testId?: string;
  readonly align?: 'start' | 'end';
  readonly className?: string;
  readonly children?: ReactNode;
  readonly onOpenChange?: (open: boolean) => void;
}
export type ViewerVersion = VersionHistoryEntry;

/** The consumer's shadcn Base UI dropdown supplies positioning, dismissal and keyboard navigation. */
export function ViewerMenu({ label, icon, items, testId = 'viewer-menu', align = 'end', className, children, onOpenChange }: ViewerMenuProps) {
  const portal = useMenuPortal();
  return <DropdownMenu onOpenChange={open => onOpenChange?.(open)}>
    <DropdownMenuTrigger render={<Button ref={portal.ref} variant="ghost" size="icon-sm" aria-label={label} title={label} data-testid={testId} className={className}>{icon}</Button>} />
    <ActionMenuContent label={label} testId={testId} items={items} align={align} container={portal.container}>{children}</ActionMenuContent>
  </DropdownMenu>;
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
    items={versionHistoryItems({ versions, current, onSelect, labels, now, testId })} />;
}
