'use client';

// Choosing the open space among the person's own.
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { spacesLabels } from './spaces-labels';
import type { SpacesLabels } from './spaces-labels';
import type { SpaceSummary } from './use-spaces';

export interface SpaceSwitcherProps {
  /** What a space is called here, as a heading ("Projects"). */
  readonly label: string;
  readonly spaces: readonly SpaceSummary[];
  readonly current: SpaceSummary | null;
  readonly onSelect: (id: string) => void;
  /** The word for a role (default: the role's id). */
  readonly roleLabel?: (role: string) => string;
  readonly labels?: SpacesLabels;
}

export function SpaceSwitcher({ label, spaces, current, onSelect, roleLabel = role => role, labels = spacesLabels }: SpaceSwitcherProps) {
  return <div className="flex items-center gap-2" data-testid="space-switcher">
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="max-w-72 justify-between gap-2" />} data-testid="space-switcher-trigger">
        <span className="truncate">{current?.title ?? labels.choose(label)}</span>
        <ChevronsUpDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {spaces.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">{labels.noSpaces}</div>}
          {spaces.map(space => <DropdownMenuItem key={space.id} onClick={() => onSelect(space.id)} data-testid={`space-${space.id}`}>
            <CheckIcon className={space.id === current?.id ? 'size-4' : 'size-4 invisible'} aria-hidden="true" />
            <span className="flex-1 truncate">{space.title}</span>
            <span className="text-xs text-muted-foreground">{roleLabel(space.role)}</span>
          </DropdownMenuItem>)}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
