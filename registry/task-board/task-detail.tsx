'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { AppWindowIcon, ChevronRightIcon, FileIcon, ImageIcon } from 'lucide-react';
import type { TaskFile, TaskQuestion, TaskRecord } from '@hachej/boring-ui-kit/task-board';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Item } from '@/components/ui/item';
import { TaskAttention } from './task-request-card';

export interface TaskDetailProps {
  readonly task: TaskRecord;
  /** Host content placed after the title card (for example a mount report or host-authorized request actions). */
  readonly actions?: ReactNode;
  /** The host reauthorizes and resolves the original question. Rendering never supplies approval. */
  readonly onAnswer?: ((task: TaskRecord, question: TaskQuestion, value: string) => void) | undefined;
  /** « Other… » opens an inline field; Send passes the typed text. No synthetic option value or approval is generated. */
  readonly onOther?: ((task: TaskRecord, question: TaskQuestion, text: string) => void) | undefined;
  /** « Discuss in chat »: the host stages `@ D-201 · <title>` and the question in its one composer, without sending. */
  readonly onDiscussQuestion?: ((task: TaskRecord, question: TaskQuestion) => void) | undefined;
  readonly onOpenFile?: ((task: TaskRecord, file: TaskFile) => void) | undefined;
  /** « Ask in the conversation »: the host focuses its composer with the task mention. */
  readonly onAsk?: ((task: TaskRecord) => void) | undefined;
  /** @deprecated Ignored; kept for source compatibility. */
  readonly labels?: unknown;
}
const preview = (value: string) => value.length > 160 ? `${value.slice(0, 160)}…` : value;
const sectionLabel = 'text-[11px] font-semibold tracking-[0.06em] text-muted-foreground';
const kinds = { markdown: ['Markdown', FileIcon], mockup: ['Mockup', AppWindowIcon], capture: ['Capture', ImageIcon] } as const;
const fileKind = (file: TaskFile) => file.kind ?? (/\.(?:md|markdown)$/i.test(file.path) ? 'markdown' : /\.html?$/i.test(file.path) ? 'mockup' : /\.(?:png|jpe?g|gif|webp|svg)$/i.test(file.path) ? 'capture' : undefined);
/** ISO times show as local HH:MM; host-formatted strings show as given. */
const clock = (value: string) => /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : value;

function AnsweredQuestion({ question }: { readonly question: TaskQuestion }) {
  const [expanded, setExpanded] = useState(false);
  return <li data-task-answered={question.id} className="min-w-0">
    <Button variant="ghost" className="grid h-auto w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] justify-normal gap-x-2 gap-y-0.5 text-start whitespace-normal" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="truncate text-[13px] font-normal">{preview(question.text)}</span>
      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground" />
      <span data-task-answer={question.id} className="col-span-full truncate text-[13px] font-normal text-muted-foreground">{question.answeredBy ? `${preview(question.answeredBy)}: ` : ''}{preview(question.answer ?? '')}</span>
    </Button>
    {expanded && <div data-task-answer-full className="flex flex-col gap-1 px-2 pb-2 text-[13px] break-words whitespace-pre-wrap"><p>{question.text}</p><p className="text-muted-foreground">{question.answeredBy && <>{question.answeredBy}: </>}{question.answer}</p></div>}
  </li>;
}

function OpenQuestion({ task, question, onAnswer, onOther, onDiscussQuestion }: Pick<TaskDetailProps, 'task' | 'onAnswer' | 'onOther' | 'onDiscussQuestion'> & { readonly question: TaskQuestion }) {
  const [other, setOther] = useState<string | null>(null);
  const send = () => { const text = other?.trim(); if (text) { onOther?.(task, question, text); setOther(null); } };
  const asked = [question.askedBy, question.askedAt && clock(question.askedAt)].filter(Boolean).join(' · ');
  return <TaskAttention active>
    <Item variant="outline" className="flex-col items-stretch gap-2" data-task-question={question.id}>
      <div className="flex items-baseline justify-between gap-2"><span className={sectionLabel}>QUESTION FOR YOU</span>{asked && <span className="text-[11px] text-muted-foreground">{asked}</span>}</div>
      <p className="text-sm">{question.text}</p>
      <div className="flex items-center gap-2">
        {question.options?.map((option, index) => {
          const value = typeof option === 'string' ? option : option.value;
          const label = typeof option === 'string' ? option : option.label;
          return <Button key={index} variant={index === 0 ? 'default' : 'outline'} disabled={!onAnswer} onClick={() => onAnswer?.(task, question, value)}>{label}</Button>;
        })}
        {onOther && <Button variant="outline" data-task-other={question.id} aria-expanded={other !== null} onClick={() => setOther(value => value === null ? '' : null)}>Other…</Button>}
        {onDiscussQuestion && <Button variant="link" className="h-auto min-w-0 shrink text-center leading-tight whitespace-normal underline" data-task-discuss={question.id} onClick={() => onDiscussQuestion(task, question)}>Discuss in chat</Button>}
      </div>
      {other !== null && <form className="flex gap-2" data-task-other-form={question.id} onSubmit={event => { event.preventDefault(); send(); }}>
        <Input autoFocus aria-label="Your answer" maxLength={4096} value={other} onChange={event => setOther(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setOther(null); } }} />
        <Button type="submit" disabled={!other.trim()}>Send</Button>
      </form>}
    </Item>
  </TaskAttention>;
}

/** Task detail (spec 3 §4), in order: title, the open question for the viewer, Answered, Files, « Ask in the conversation ». */
export function TaskDetail({ task, actions, onAnswer, onOther, onDiscussQuestion, onOpenFile, onAsk }: TaskDetailProps) {
  const [showAll, setShowAll] = useState(false);
  const open = task.waiting_on_you === true ? task.questions?.find(question => question.answer === undefined) : undefined;
  const answered = task.questions?.filter(question => question.answer !== undefined).toReversed().sort((a, b) => (Date.parse(b.answeredAt ?? '') || 0) - (Date.parse(a.answeredAt ?? '') || 0)) ?? [];
  const meta = [task.screen && `Screen: ${task.screen}`, task.requester && `asked by ${task.requester}`, task.refiner && `refined by ${task.refiner}`].filter(Boolean).join(' · ');
  const folder = task.folder?.replace(/\/?$/, '/');
  return <div className="flex min-w-0 flex-col gap-2.5" data-task-detail={task.id}>
    <div className="rounded-[var(--radius-lg)] bg-card"><Item variant="outline" className="flex-col items-stretch gap-1" data-task-title-card="">
      <h2 className="text-base font-semibold break-words">{task.title}</h2>
      {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
    </Item></div>
    {actions}
    {open && <div className="rounded-[var(--radius-lg)] bg-card"><OpenQuestion key={open.id} task={task} question={open} onAnswer={onAnswer} onOther={onOther} onDiscussQuestion={onDiscussQuestion} /></div>}
    {!!answered.length && <section aria-label="Answered questions" className="rounded-[var(--radius-lg)] bg-card"><Item variant="outline" className="flex-col items-stretch gap-0">
      <div className="flex items-baseline justify-between gap-2 pl-2.5"><h3 className={sectionLabel}>ANSWERED · {answered.length}</h3>
        {answered.length > 3 && <Button variant="link" size="xs" className="underline" data-task-show-answers aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? 'Show latest' : 'Show all'}</Button>}</div>
      <ul className="flex min-w-0 flex-col">{(showAll ? answered : answered.slice(0, 3)).map(question => <AnsweredQuestion key={question.id} question={question} />)}</ul>
    </Item></section>}
    {!!task.files?.length && <section aria-label="Task files" className="rounded-[var(--radius-lg)] bg-card"><Item variant="outline" className="flex-col items-stretch gap-0.5">
      <h3 className={`${sectionLabel} px-2.5 pb-1`}>FILES{folder && ` · ${folder}`}</h3>
      {task.files.map(file => {
        const kind = fileKind(file), [label, Icon] = kind ? kinds[kind] : ['', FileIcon];
        const name = file.name ?? (folder && file.path.startsWith(folder) ? file.path.slice(folder.length) : file.path.split('/').pop());
        const content = <><Icon aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-start text-[13px] font-normal">{name}</span>{label && <span className="text-[11px] font-normal text-muted-foreground">{label}</span>}</>;
        return onOpenFile ? <Button key={file.path} variant="ghost" className="w-full justify-start" data-task-file={file.path} onClick={() => onOpenFile(task, file)}>{content}</Button> : <p key={file.path} className="flex items-center gap-2">{content}</p>;
      })}
    </Item></section>}
    {onAsk && <Button variant="link" className="self-start underline" data-task-ask={task.id} onClick={() => onAsk(task)}>Ask in the conversation</Button>}
  </div>;
}
