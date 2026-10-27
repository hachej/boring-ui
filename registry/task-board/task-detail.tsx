'use client';

import { Badge } from '@/components/ui/badge';
import { Markdown } from '../pi-chat-markdown/markdown';
import { ChatTextProvider, useChatText } from '../pi-chat/labels';
import type { ChatLabels } from '../pi-chat/labels';
import { defaultTaskBoardLabels, waitsOnViewer } from './model';
import type { TaskBoardLabels, TaskCard } from './model';

export interface TaskDetailProps {
  readonly task: TaskCard;
  readonly viewerId?: string;
  readonly labels?: Partial<TaskBoardLabels> & { readonly markdown?: Partial<ChatLabels> };
}

/** Read-only content for a host-owned Sheet, side panel or page; never opens or fetches anything. */
export function TaskDetail({ task, viewerId, labels: overrides }: TaskDetailProps) {
  const labels = { ...defaultTaskBoardLabels, ...overrides };
  const chat = useChatText();
  const timestamp = (at: string) => Number.isFinite(Date.parse(at)) ? labels.dateTime(at) : labels.unknownTime;
  return <section data-boring="task-detail" aria-label={labels.details} className="flex min-w-0 flex-col gap-5">
    <header className="flex flex-col gap-2">
      <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
      <h2 className="text-base font-medium [overflow-wrap:anywhere]">{task.title}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{labels[task.state]}</Badge>
        {task.state === 'waiting' && task.waiting_on && <Badge variant={waitsOnViewer(task, viewerId) ? 'default' : 'secondary'}>{waitsOnViewer(task, viewerId) ? labels.waitingOnYou : labels.waitingOn(task.waiting_on.who)}</Badge>}
        {task.risk === 'high' && <Badge variant="destructive">{labels.highRisk}</Badge>}
        {task.children && <span className="text-xs text-muted-foreground tabular-nums">{labels.children(task.children.done, task.children.total)}</span>}
      </div>
    </header>
    {task.waiting_on?.question && <section className="flex flex-col gap-2"><h3 className="text-sm font-medium">{labels.question}</h3><p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{task.waiting_on.question}</p></section>}
    {(task.parent || task.route || task.createdBy || !!task.labels?.length) && <dl className="grid grid-cols-2 gap-2 text-sm [overflow-wrap:anywhere]">
      {task.parent && <><dt className="text-muted-foreground">{labels.parent}</dt><dd>{task.parent}</dd></>}
      {task.route && <><dt className="text-muted-foreground">{labels.route}</dt><dd>{task.route}</dd></>}
      {task.createdBy && <><dt className="text-muted-foreground">{labels.createdBy}</dt><dd>{task.createdBy}</dd></>}
      {!!task.labels?.length && <><dt className="text-muted-foreground">{labels.tags}</dt><dd>{task.labels.join(', ')}</dd></>}
    </dl>}
    {task.spec && <section className="flex min-w-0 flex-col gap-2"><h3 className="text-sm font-medium">{labels.specification}</h3><ChatTextProvider value={{ ...chat, labels: { ...chat.labels, ...overrides?.markdown } }}><Markdown text={task.spec} /></ChatTextProvider></section>}
    {!!task.history?.length && <section className="flex flex-col gap-2"><h3 className="text-sm font-medium">{labels.history}</h3><ol className="flex flex-col gap-3">{task.history.map((event, index) => <li key={event.id ?? index} className="flex flex-col gap-1"><p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{event.text}</p><time dateTime={Number.isFinite(Date.parse(event.at)) ? event.at : undefined} className="text-xs text-muted-foreground">{timestamp(event.at)}</time></li>)}</ol></section>}
  </section>;
}
