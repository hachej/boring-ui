'use client';

import { useMemo } from 'react';
import { ClipboardListIcon } from 'lucide-react';
import type { MentionsConfig } from '../pi-chat/config';
import { pmTextFr } from './pm-text';
import type { PmText } from './pm-text';

export interface TaskMention {
  readonly id: string;
  readonly title: string;
  /** The task waits on the viewer: « À vous » / "On you". */
  readonly onYou?: boolean;
}
/** The host supplies the task board's authorized data and its existing present action. No fetching or task store is installed. */
export interface TaskMentionSource {
  readonly search: (query: string, options: { readonly filter: 'mine' | 'all'; readonly signal: AbortSignal }) => Promise<readonly TaskMention[]>;
  readonly title: (id: string) => string | undefined;
  readonly present: (id: string) => void;
  readonly generation?: string | number;
}

/** Spec 1 §8 (D9): the viewer's tasks for this app, at most 6 rows, under « TÂCHES · {query} »; the `@ D-201 · Title` chip opens the task. */
export function useTaskMentions(source: TaskMentionSource | undefined, base: MentionsConfig | undefined, text: PmText = pmTextFr): MentionsConfig | undefined {
  return useMemo(() => {
    if (!source) return base;
    const onYou = new Set<string>();
    return {
      ...base,
      listLabel: text.mentionHeader('').replace(/ · $/, ''), generation: source.generation,
      pickerHeader: (query: string) => <p data-testid="pm-mention-header" className="m-0 px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">{text.mentionHeader(query)}</p>,
      search: async (query: string, signal: AbortSignal) => {
        const tasks = await source.search(query.replace(/^task:/, ''), { filter: 'mine', signal });
        if (signal.aborted) return [];
        for (const task of tasks) if (task.onYou) onYou.add(task.id); else onYou.delete(task.id);
        return tasks.slice(0, 6).map(task => ({ path: `task:${task.id}`, label: `${task.id} · ${task.title}` }));
      },
      renderOption: item => {
        const id = item.path.replace(/^task:/, ''), title = (item.label ?? '').slice(id.length + 3);
        return <span data-testid="pm-mention-row" className="flex w-full min-w-0 items-center gap-2 text-[13px]">
          <span className="w-11 shrink-0 text-[11px] text-muted-foreground">{id}</span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {onYou.has(id) && <span className="shrink-0 rounded-pm-round bg-primary px-2 text-xs text-primary-foreground">{text.onYou}</span>}
        </span>;
      },
      kinds: { ...base?.kinds, task: { label: (id: string) => `@ ${id}${source.title(id) ? ` · ${source.title(id)}` : ''}`, icon: <ClipboardListIcon aria-hidden="true" />, open: source.present } },
    } satisfies MentionsConfig;
  }, [source, base, text]);
}
