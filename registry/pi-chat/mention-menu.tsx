'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FileTextIcon, FolderIcon } from 'lucide-react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePickerKeyboard } from './picker-keyboard';
import type { MentionResult, MentionsConfig } from './config';
import { useChatText } from './labels';

/**
 * The host's shadcn Popover above the composer, anchored to the nearest positioned ancestor's top edge and as wide as it.
 * Focus stays in the message box (the picker keyboard drives the rows); outside presses dismiss it.
 */
export function ComposerSuggestions({ testId, onDismiss, children }: { readonly testId: string; readonly onDismiss: () => void; readonly children: ReactNode }) {
  return <Popover open modal={false} onOpenChange={open => { if (!open) onDismiss(); }}>
    <PopoverTrigger nativeButton={false} render={<span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" />} />
    <PopoverContent data-testid={testId} side="top" align="start" initialFocus={false} finalFocus={false} className="pi-chat w-(--anchor-width) max-w-[calc(100vw-1rem)]">
      {children}
    </PopoverContent>
  </Popover>;
}

function highlight(text: string, query: string) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="bg-transparent text-foreground underline underline-offset-2">{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

/** The `@` file picker, ported from v2's `MentionPicker`: debounced search, one highlighted row, name over path. */
export function MentionPicker({ query, search, generation, onSelect, onDismiss }: {
  readonly query: string;
  readonly generation?: MentionsConfig['generation'];
  readonly search: MentionsConfig['search'];
  readonly onSelect: (path: string) => void;
  readonly onDismiss: () => void;
}) {
  const { labels } = useChatText();
  // Results are tagged with the search function that produced them: a binding switch hides the previous binding's rows at once.
  const [outcome, setOutcome] = useState<{ readonly search: MentionsConfig['search']; readonly results: readonly MentionResult[]; readonly failure: string | null }>();
  const shown = outcome?.search === search ? outcome : undefined;
  const results = shown?.results ?? [];
  const failure = shown?.failure ?? null;
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const searcher = useRef(search); searcher.current = search;
  useEffect(() => {
    setActive(0);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      searcher.current(query, abort.signal).then(found => { if (!abort.signal.aborted) setOutcome({ search, results: found.slice(0, 8), failure: null }); },
        cause => { if (!abort.signal.aborted) setOutcome({ search, results: [], failure: cause instanceof Error ? cause.message : labels.searchFailed }); });
    }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, search, generation]);
  usePickerKeyboard({ count: results.length, activeIdx: active, setActiveIdx: setActive, listRef: list, onSelect: index => { const item = results[index]; if (item) onSelect(item.path); }, onDismiss });

  if (results.length === 0 && !failure) return null;
  return <ComposerSuggestions testId="mention-menu" onDismiss={onDismiss}>
    {failure ? <div role="alert" data-testid="mention-error" className="text-xs text-destructive">{failure}</div>
      : <ul ref={list} role="listbox" aria-label={labels.workspaceFiles} className="m-0 flex max-h-[min(14rem,40dvh)] list-none flex-col overflow-y-auto p-0">
        {results.map((item, index) => {
          const name = item.path.split('/').pop() ?? item.path;
          const Icon = item.kind === 'directory' ? FolderIcon : FileTextIcon;
          return <Item key={item.path} render={<li />} size="xs" variant={index === active ? 'muted' : 'default'} role="option" aria-selected={index === active} data-testid="mention-item" data-path={item.path} title={item.path}
            onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); onSelect(item.path); }}
            className="cursor-pointer flex-nowrap max-sm:min-h-11 pointer-coarse:min-h-11">
            <ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia>
            <ItemContent className="min-w-0"><ItemTitle>{highlight(name, query)}</ItemTitle>
              <ItemDescription className="m-0 truncate">{item.path}</ItemDescription></ItemContent>
          </Item>;
        })}
      </ul>}
  </ComposerSuggestions>;
}
