'use client';

import { useMemo } from 'react';
import { selectTasks, taskReference } from '@hachej/boring-ui-kit/task-board';
import type { MentionsConfig } from '../pi-chat/config';
import { taskMentions } from '../task-mentions/task-mentions';
import { pmTextFr } from './pm-text';
import type { PmText } from './pm-text';
import type { StudioTaskBoardSeam } from './use-pm-panel';

/**
 * Spec 1 §8 (D9) on the shared `task-mentions` item: the viewer's own requests, at most 6 rows, under « TÂCHES · {query} », with
 * « À vous » when a task waits on the viewer. Search, the chip and opening stay `taskMentions`'; only the picker's look is the PM's.
 */
export function usePmMentions(seam: StudioTaskBoardSeam | undefined, base: MentionsConfig | undefined, text: PmText = pmTextFr): MentionsConfig | undefined {
  return useMemo(() => {
    if (!seam) return base;
    const mine = selectTasks(seam.tasks, { filter: 'mine', currentUser: seam.currentUser });
    const shared = taskMentions({ tasks: mine, onOpen: seam.onOpen, ...(base ? { base } : {}) });
    return {
      ...shared,
      listLabel: text.mentionHeader('').replace(/ · $/, ''),
      pickerHeader: (query: string) => <p data-testid="pm-mention-header" className="m-0 px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">{text.mentionHeader(query)}</p>,
      search: async (query: string, signal: AbortSignal) => (await shared.search(query.replace(/^task:/, ''), signal)).slice(0, 6),
      renderOption: (item, query) => {
        const task = mine.find(candidate => `task:${candidate.id}` === item.path);
        if (!task) return base?.renderOption?.(item, query) ?? item.label ?? item.path;
        return <span data-testid="pm-mention-row" className="flex w-full min-w-0 items-center gap-2 text-[13px]">
          <span className="w-11 shrink-0 text-[11px] text-muted-foreground">{taskReference(task)}</span>
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
          {task.waiting_on_you && <span className="shrink-0 rounded-pm-round bg-primary px-2 text-xs text-primary-foreground">{text.onYou}</span>}
        </span>;
      },
    } satisfies MentionsConfig;
  }, [seam, base, text]);
}
