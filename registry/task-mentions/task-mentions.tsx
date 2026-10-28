import { ListTodoIcon } from 'lucide-react';
import { taskReference } from '@hachej/boring-ui-kit/task-board';
import type { TaskRecord } from '@hachej/boring-ui-kit/task-board';
import type { MentionsConfig } from '../pi-chat/config';
import { MentionPicker } from '../pi-chat-mentions/mention-menu';

/** Authorized tasks only. Composes, never replaces, the host's file search and other mention kinds. */
export function taskMentions({ tasks, onOpen, base }: {
  readonly tasks: readonly TaskRecord[];
  readonly onOpen: (task: TaskRecord) => void;
  readonly base?: MentionsConfig;
}): MentionsConfig {
  const find = (id: string) => tasks.find(task => task.id === id || taskReference(task) === id);
  const label = (id: string) => { const task = find(id); return task ? `@ ${taskReference(task)} · ${task.title}` : id; };
  return {
    ...base,
    Picker: base?.Picker ?? MentionPicker,
    listLabel: base?.listLabel ?? 'Tasks and files',
    kinds: { ...base?.kinds, task: { label, icon: <ListTodoIcon aria-hidden="true" />, open: id => { const task = find(id); if (task) onOpen(task); } } },
    search: async (query, signal) => {
      const needle = query.toLocaleLowerCase();
      const matches = tasks.filter(task => `${taskReference(task)} ${task.title}`.toLocaleLowerCase().includes(needle))
        .sort((a, b) => Number(b.waiting_on_you === true) - Number(a.waiting_on_you === true))
        .map(task => ({ path: `task:${task.id}`, label: `${taskReference(task)} · ${task.title}${task.waiting_on_you ? ' · Waiting on you' : ''}` }));
      const files = await base?.search(query, signal) ?? [];
      return signal.aborted ? [] : [...matches, ...files];
    },
  };
}
