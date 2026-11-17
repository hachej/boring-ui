'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { PlayIcon, SearchIcon, SlashIcon, SparklesIcon } from '../_shared/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { usePickerKeyboard } from '../pi-chat/picker-keyboard';
import { ComposerSuggestions } from '../pi-chat/suggestions';
import { slashGroup } from '@hachej/boring-ui-kit/chat-text';
import type { SlashPickerProps } from '../pi-chat/config';
import { useChatText } from '../pi-chat/labels';

const ALL = '__all__';

/**
 * The `/` picker, ported from v2's `SlashCommandPicker`: a search box seeded from what was typed after `/`, filter chips
 * (All, built-in, skills, plugin names), then rows with a name, badges and a one line description.
 */
export function SlashPicker({ query, items, onSelect, onDismiss, bare = false }: SlashPickerProps) {
  const { labels } = useChatText();
  const [group, setGroup] = useState(ALL);
  const [search, setSearch] = useState(query);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  // Follow the composer text.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the search box follows the composer's query when it changes, and stays editable in between
  useEffect(() => { setSearch(query); setActive(0); }, [query]);
  const groups = useMemo(() => [...new Set(items.map(slashGroup))].sort((a, b) => a.localeCompare(b)), [items]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const found = items.filter(item => (group === ALL || slashGroup(item) === group)
      && (!needle || item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)));
    // The bar's menu lists one heading per group: keep each group together, in the order its first entry came.
    if (!bare) return found;
    const order = [...new Set(found.map(slashGroup))];
    return [...found].sort((a, b) => order.indexOf(slashGroup(a)) - order.indexOf(slashGroup(b)));
  }, [items, search, group, bare]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a shorter list pulls the highlighted row back inside it; the updater returns the same index when it already fits
  useEffect(() => { setActive(index => filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)); }, [filtered.length]);
  usePickerKeyboard({ count: filtered.length, activeIdx: active, setActiveIdx: setActive, listRef: list, onSelect: index => { const item = filtered[index]; if (item) onSelect(item); }, onDismiss });

  const optionId = (index: number) => `pi-chat-slash-${index}`;
  return <ComposerSuggestions testId="slash-menu" onDismiss={onDismiss}>
    {!bare && <><InputGroup>
      <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput className="max-sm:min-h-11 pointer-coarse:min-h-11" aria-label={labels.searchCommands} data-testid="slash-search" type="text" autoComplete="off" spellCheck={false} value={search}
        onChange={event => { setSearch(event.currentTarget.value); setActive(0); }} placeholder={labels.searchCommands} />
    </InputGroup>
    <div role="tablist" aria-label={labels.filterBySource} className="flex flex-wrap gap-1">
      {[ALL, ...groups].map(name => <Button key={name} size="xs" variant={group === name ? 'secondary' : 'ghost'} role="tab" aria-selected={group === name} data-testid="slash-chip" data-group={name === ALL ? 'all' : name}
        onMouseDown={event => { event.preventDefault(); setGroup(name); setActive(0); }}>{name === ALL ? labels.allSources : labels.slashGroup(name)}</Button>)}
    </div></>}
    {filtered.length === 0
      ? <div data-testid="slash-empty" className="text-xs text-muted-foreground">{labels.noCommands}</div>
      : <ul ref={list} role="listbox" aria-label={labels.commands} className="m-0 flex max-h-[min(20rem,45dvh)] list-none flex-col overflow-y-auto p-0">
        {filtered.map((item, index) => <Fragment key={`${item.source}:${item.name}`}>
        {bare && (index === 0 || slashGroup(filtered[index - 1]!) !== slashGroup(item)) && <li role="presentation" data-testid="slash-heading" data-group={slashGroup(item)} className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground select-none first:pt-1">{labels.slashHeading(slashGroup(item))}</li>}
        <Item render={<li />} size="xs" variant={index === active ? 'muted' : 'default'} id={optionId(index)} role="option" aria-selected={index === active} title={item.description || undefined}
          data-testid="slash-item" data-name={item.name} data-source={item.source} data-active={index === active ? 'true' : undefined}
          onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); onSelect(item); }}
          className="cursor-pointer flex-nowrap max-sm:min-h-11 pointer-coarse:min-h-11">
          {bare && (() => { const Icon = item.source === 'skill' ? SparklesIcon : item.source === 'action' ? PlayIcon : SlashIcon; return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />; })()}
          <ItemContent className="min-w-0">
            <ItemTitle>/{item.name}{item.argumentHint && <span data-testid="slash-hint" className="font-normal text-muted-foreground"> {item.argumentHint}</span>}
              {item.source === 'skill' && <Badge variant="secondary" data-testid="slash-badge-skill">{labels.skillBadge}</Badge>}
              {item.sourcePlugin && <Badge variant="outline" data-testid="slash-badge-source">{item.sourcePlugin}</Badge>}
            </ItemTitle>
            {item.description && <ItemDescription className="m-0 truncate">{item.description}</ItemDescription>}
          </ItemContent>
        </Item></Fragment>)}
      </ul>}
  </ComposerSuggestions>;
}
