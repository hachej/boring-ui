'use client';

import { useEffect, useRef, useState } from 'react';
import { FileTextIcon, FolderIcon } from 'lucide-react';
import { usePickerKeyboard } from './picker-keyboard';
import type { MentionResult, MentionsConfig } from './config';
import { cn } from '../utils/utils';
import { useChatText } from './labels';

function highlight(text: string, query: string) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="bg-transparent font-semibold text-foreground underline decoration-ring/60 underline-offset-2">{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>;
}

/** The `@` file picker, ported from v2's `MentionPicker`: debounced search, one highlighted row, name over path. */
export function MentionMenu({ query, search, onSelect, onDismiss }: {
  readonly query: string;
  readonly search: MentionsConfig['search'];
  readonly onSelect: (path: string) => void;
  readonly onDismiss: () => void;
}) {
  const { labels } = useChatText();
  const [results, setResults] = useState<readonly MentionResult[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null), container = useRef<HTMLDivElement>(null);
  const searcher = useRef(search); searcher.current = search;
  useEffect(() => {
    setActive(0);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      searcher.current(query, abort.signal).then(found => { if (!abort.signal.aborted) { setResults(found.slice(0, 8)); setFailure(null); } },
        cause => { if (!abort.signal.aborted) { setResults([]); setFailure(cause instanceof Error ? cause.message : labels.searchFailed); } });
    }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query]);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (container.current && !container.current.contains(event.target as Node)) onDismiss(); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [onDismiss]);
  usePickerKeyboard({ count: results.length, activeIdx: active, setActiveIdx: setActive, listRef: list, onSelect: index => { const item = results[index]; if (item) onSelect(item.path); }, onDismiss });

  if (results.length === 0 && !failure) return null;
  return <div ref={container} data-testid="mention-menu" className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
    {failure ? <div role="alert" data-testid="mention-error" className="px-3 py-2 text-xs text-destructive">{failure}</div>
      : <ul ref={list} role="listbox" aria-label={labels.workspaceFiles} className="m-0 max-h-[min(14rem,40dvh)] list-none overflow-y-auto p-0 py-1">
        {results.map((item, index) => {
          const name = item.path.split('/').pop() ?? item.path;
          const Icon = item.kind === 'directory' ? FolderIcon : FileTextIcon;
          return <li key={item.path} role="option" aria-selected={index === active} data-testid="mention-item" data-path={item.path} title={item.path}
            onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); onSelect(item.path); }}
            className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs max-sm:min-h-11 pointer-coarse:min-h-11', index === active ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
            <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
            <span className="flex min-w-0 flex-col gap-0.5"><span className="truncate font-medium text-foreground">{highlight(name, query)}</span>
              <span className="truncate text-[0.6875rem] opacity-70">{item.path}</span></span>
          </li>;
        })}
      </ul>}
  </div>;
}
