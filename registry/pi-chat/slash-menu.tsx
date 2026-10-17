'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { usePickerKeyboard } from './picker-keyboard';
import { ComposerSuggestions } from './mention-menu';
import { slashGroup } from './config';
import type { SlashItem } from './config';
import { useChatText } from './labels';

const ALL = '__all__';

/**
 * The `/` picker, ported from v2's `SlashCommandPicker`: a search box seeded from what was typed after `/`, filter chips
 * (All, built-in, skills, plugin names), then rows with a name, badges and a one line description.
 */
export function SlashPicker({ query, items, onSelect, onDismiss }: {
  readonly query: string;
  readonly items: readonly SlashItem[];
  readonly onSelect: (item: SlashItem) => void;
  readonly onDismiss: () => void;
}) {
  const { labels } = useChatText();
  const [group, setGroup] = useState(ALL);
  const [search, setSearch] = useState(query);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  // Follow the composer text.
  useEffect(() => { setSearch(query); setActive(0); }, [query]);
  const groups = useMemo(() => [...new Set(items.map(slashGroup))].sort((a, b) => a.localeCompare(b)), [items]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(item => (group === ALL || slashGroup(item) === group)
      && (!needle || item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)));
  }, [items, search, group]);
  useEffect(() => { setActive(index => filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)); }, [filtered.length]);
  usePickerKeyboard({ count: filtered.length, activeIdx: active, setActiveIdx: setActive, listRef: list, onSelect: index => { const item = filtered[index]; if (item) onSelect(item); }, onDismiss });

  const optionId = (index: number) => `pi-chat-slash-${index}`;
  return <ComposerSuggestions testId="slash-menu" onDismiss={onDismiss}>
    <InputGroup>
      <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput aria-label={labels.searchCommands} data-testid="slash-search" type="text" autoComplete="off" spellCheck={false} value={search}
        onChange={event => { setSearch(event.currentTarget.value); setActive(0); }} placeholder={labels.searchCommands} />
    </InputGroup>
    <div role="tablist" aria-label={labels.filterBySource} className="flex flex-wrap gap-1">
      {[ALL, ...groups].map(name => <Button key={name} size="xs" variant={group === name ? 'secondary' : 'ghost'} role="tab" aria-selected={group === name} data-testid="slash-chip" data-group={name === ALL ? 'all' : name}
        onMouseDown={event => { event.preventDefault(); setGroup(name); setActive(0); }}>{name === ALL ? labels.allSources : labels.slashGroup(name)}</Button>)}
    </div>
    {filtered.length === 0
      ? <div data-testid="slash-empty" className="text-xs text-muted-foreground">{labels.noCommands}</div>
      : <ul ref={list} role="listbox" aria-label={labels.commands} className="m-0 flex max-h-[min(20rem,45dvh)] list-none flex-col overflow-y-auto p-0">
        {filtered.map((item, index) => <Item key={`${item.source}:${item.name}`} render={<li />} size="xs" variant={index === active ? 'muted' : 'default'} id={optionId(index)} role="option" aria-selected={index === active} title={item.description || undefined}
          data-testid="slash-item" data-name={item.name} data-source={item.source} data-active={index === active ? 'true' : undefined}
          onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); onSelect(item); }}
          className="cursor-pointer flex-nowrap max-sm:min-h-11 pointer-coarse:min-h-11">
          <ItemContent className="min-w-0">
            <ItemTitle>/{item.name}
              {item.source === 'skill' && <Badge variant="secondary" data-testid="slash-badge-skill">{labels.skillBadge}</Badge>}
              {item.sourcePlugin && <Badge variant="outline" data-testid="slash-badge-source">{item.sourcePlugin}</Badge>}
            </ItemTitle>
            {item.description && <ItemDescription className="truncate">{item.description}</ItemDescription>}
          </ItemContent>
        </Item>)}
      </ul>}
  </ComposerSuggestions>;
}
