'use client';

import { useMemo, useState } from 'react';
import { ClipboardListIcon } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { MentionsConfig } from '../pi-chat/config';

export interface TaskMention { readonly id: string; readonly title: string }
/** The host supplies the task board's authorized data and its existing present action. No fetching or task store is installed. */
export interface TaskMentionSource {
  readonly search: (query: string, options: { readonly filter: 'mine' | 'all'; readonly signal: AbortSignal }) => Promise<readonly TaskMention[]>;
  readonly title: (id: string) => string | undefined;
  readonly present: (id: string) => void;
  readonly generation?: string | number;
}

export function useTaskMentions(source: TaskMentionSource | undefined, base: MentionsConfig | undefined): MentionsConfig | undefined {
  const [filter, setFilter] = useState<'mine' | 'all'>('mine');
  return useMemo(() => source ? {
    ...base,
    listLabel: 'Demandes', generation: source.generation,
    search: async (query: string, signal: AbortSignal) => {
      const tasks = await source.search(query.replace(/^task:/, ''), { filter, signal });
      if (signal.aborted) return [];
      return tasks.slice(0, 50).map(task => ({ path: `task:${task.id}`, label: `${task.id} · ${task.title}` }));
    },
    pickerHeader: <ToggleGroup value={[filter]} onValueChange={values => { if (values[0] === 'mine' || values[0] === 'all') setFilter(values[0]); }} aria-label="Demandes à mentionner">
      <ToggleGroupItem value="mine" data-testid="pm-tasks-mine">Mes demandes</ToggleGroupItem><ToggleGroupItem value="all" data-testid="pm-tasks-all">Toutes</ToggleGroupItem>
    </ToggleGroup>,
    kinds: { ...base?.kinds, task: { label: (id: string) => `@ ${id}${source.title(id) ? ` · ${source.title(id)}` : ''}`, icon: <ClipboardListIcon aria-hidden="true" />, open: source.present } },
  } : base, [source, base, filter]);
}
