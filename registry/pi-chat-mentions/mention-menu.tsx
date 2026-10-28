'use client';

import { useEffect, useRef, useState } from 'react';
import { FileTextIcon, FolderIcon } from 'lucide-react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { usePickerKeyboard } from '../pi-chat/picker-keyboard';
import { ComposerSuggestions } from '../pi-chat/suggestions';
import type { MentionPickerProps, MentionResult, MentionsConfig } from '../pi-chat/config';
import { useChatText } from '../pi-chat/labels';

function highlight(text: string, query: string) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="bg-transparent text-foreground underline underline-offset-2">{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

/** The `@` file picker, ported from v2's `MentionPicker`: debounced search, one highlighted row, name over path. */
export function MentionPicker({ query, search, generation, listLabel, renderOption, header, onSelect, onDismiss }: MentionPickerProps) {
  const { labels } = useChatText();
  // Results are tagged with the search function that produced them: a binding switch hides the previous binding's rows at once.
  const [outcome, setOutcome] = useState<{ readonly search: MentionsConfig['search']; readonly results: readonly MentionResult[]; readonly failure: string | null }>();
  const shown = outcome?.search === search ? outcome : undefined;
  const results = shown?.results ?? [];
  const failure = shown?.failure ?? null;
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new query, search or generation starts at the first row, together with the search it starts
    setActive(0);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      search(query, abort.signal).then(found => { if (!abort.signal.aborted) setOutcome({ search, results: found.slice(0, 8), failure: null }); },
        cause => { if (!abort.signal.aborted) setOutcome({ search, results: [], failure: cause instanceof Error ? cause.message : labels.searchFailed }); });
    }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the failure text is read when a search fails; a new label must not search again
  }, [query, search, generation]);
  usePickerKeyboard({ count: results.length, activeIdx: active, setActiveIdx: setActive, listRef: list, onSelect: index => { const item = results[index]; if (item) onSelect(item.path); }, onDismiss });

  if (results.length === 0 && !failure && !header) return null;
  return <ComposerSuggestions testId="mention-menu" onDismiss={onDismiss}>
    {header}
    {failure ? <div role="alert" data-testid="mention-error" className="text-xs text-destructive">{failure}</div>
      : <ul ref={list} role="listbox" aria-label={listLabel ?? labels.workspaceFiles} className="m-0 flex max-h-[min(14rem,40dvh)] list-none flex-col overflow-y-auto p-0">
        {results.map((item, index) => {
          const name = item.label ?? item.path.split('/').pop() ?? item.path;
          const Icon = item.kind === 'directory' ? FolderIcon : FileTextIcon;
          return <Item key={item.path} render={<li />} size="xs" variant={index === active ? 'muted' : 'default'} role="option" aria-selected={index === active} data-testid="mention-item" data-path={item.path} title={item.label ?? item.path}
            onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); onSelect(item.path); }}
            className="cursor-pointer flex-nowrap max-sm:min-h-11 pointer-coarse:min-h-11">
            {renderOption ? renderOption(item, query) : <><ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia>
            <ItemContent className="min-w-0"><ItemTitle>{highlight(name, query)}</ItemTitle>
              <ItemDescription className="m-0 truncate">{item.path}</ItemDescription></ItemContent></>}
          </Item>;
        })}
      </ul>}
  </ComposerSuggestions>;
}
