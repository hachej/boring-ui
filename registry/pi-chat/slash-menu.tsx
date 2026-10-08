'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePickerKeyboard } from './picker-keyboard';
import { slashGroup } from './config';
import type { SlashItem } from './config';
import { cn } from '../utils/utils';
import { useChatText } from './labels';

const ALL = '__all__';

/**
 * The `/` menu, ported from v2's `SlashCommandPicker`: a search box seeded from what was typed after `/`, filter chips
 * (All, built-in, skills, plugin names), then rows with a name, badges and a one line description.
 */
export function SlashMenu({ query, items, onSelect, onDismiss }: {
  readonly query: string;
  readonly items: readonly SlashItem[];
  readonly onSelect: (item: SlashItem) => void;
  readonly onDismiss: () => void;
}) {
  const { labels } = useChatText();
  const [group, setGroup] = useState(ALL);
  const [search, setSearch] = useState(query);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null), list = useRef<HTMLUListElement>(null);
  // Follow the composer text.
  useEffect(() => { setSearch(query); setActive(0); }, [query]);
  const groups = useMemo(() => [...new Set(items.map(slashGroup))].sort((a, b) => a.localeCompare(b)), [items]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(item => (group === ALL || slashGroup(item) === group)
      && (!needle || item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)));
  }, [items, search, group]);
  useEffect(() => { setActive(index => filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)); }, [filtered.length]);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (container.current && !container.current.contains(event.target as Node)) onDismiss(); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [onDismiss]);
  usePickerKeyboard({ count: filtered.length, activeIdx: active, setActiveIdx: setActive, listRef: list, onSelect: index => { const item = filtered[index]; if (item) onSelect(item); }, onDismiss });

  const optionId = (index: number) => `pi-chat-slash-${index}`;
  return <div ref={container} data-testid="slash-menu" className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
    <input aria-label={labels.searchCommands} data-testid="slash-search" type="text" autoComplete="off" spellCheck={false} value={search}
      onChange={event => { setSearch(event.currentTarget.value); setActive(0); }}
      className="block w-full border-0 border-b border-border/60 bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground sm:text-xs max-sm:min-h-11" placeholder={labels.searchCommands} />
    <div role="tablist" aria-label={labels.filterBySource} className="flex flex-wrap gap-1 border-b border-border/60 px-2 py-1.5">
      {[ALL, ...groups].map(name => <button key={name} type="button" role="tab" aria-selected={group === name} data-testid="slash-chip" data-group={name === ALL ? 'all' : name}
        onMouseDown={event => { event.preventDefault(); setGroup(name); setActive(0); }}
        className={cn('cursor-pointer rounded-full px-2 py-px text-[0.6875rem] font-medium transition-colors max-sm:min-h-10 max-sm:min-w-10 max-sm:px-3 pointer-coarse:min-h-10 pointer-coarse:min-w-10 motion-reduce:transition-none',
          group === name ? 'bg-foreground/10 text-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70')}>{name === ALL ? labels.allSources : labels.slashGroup(name)}</button>)}
    </div>
    {filtered.length === 0
      ? <div data-testid="slash-empty" className="px-3 py-2 text-xs text-muted-foreground">{labels.noCommands}</div>
      : <ul ref={list} role="listbox" aria-label={labels.commands} className="m-0 max-h-[min(20rem,45dvh)] list-none overflow-y-auto p-0 py-1">
        {filtered.map((item, index) => <li key={`${item.source}:${item.name}`} id={optionId(index)} role="option" aria-selected={index === active} title={item.description || undefined}
          data-testid="slash-item" data-name={item.name} data-source={item.source} data-active={index === active ? 'true' : undefined}
          onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); onSelect(item); }}
          className={cn('flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-xs max-sm:min-h-11 max-sm:justify-center pointer-coarse:min-h-11 pointer-coarse:justify-center', index === active ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">/{item.name}</span>
            {item.source === 'skill' && <span data-testid="slash-badge-skill" className="rounded-sm bg-primary/10 px-1 py-px text-[0.5625rem] font-semibold tracking-wide text-foreground uppercase">{labels.skillBadge}</span>}
            {item.sourcePlugin && <span data-testid="slash-badge-source" className="rounded-sm bg-muted px-1 py-px text-[0.5625rem] font-medium text-muted-foreground">{item.sourcePlugin}</span>}
          </span>
          {item.description && <span className="truncate text-[0.6875rem] opacity-70">{item.description}</span>}
        </li>)}
      </ul>}
  </div>;
}
