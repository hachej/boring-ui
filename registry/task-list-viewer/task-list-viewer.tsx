'use client';

import { randomUUID } from '@hachej/boring-files/platform';
import React, { useId, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { ReadResult } from '@hachej/boring-files';
import type { SaveResult } from '@hachej/boring-ui-kit/resources';
import type { TaskListController } from './task-list-controller';
import type { TaskListOperation } from './task-list-document';

export interface TaskListViewerProps {
  readonly controller: TaskListController;
  readonly title?: string;
  readonly className?: string;
}

export function TaskListViewer({ controller, title = 'Tasks', className }: TaskListViewerProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // A fresh owner per controller: drafts and notices of another controller are dropped, and a late result of one is ignored.
  const current = useRef({ controller });
  // eslint-disable-next-line react-hooks/refs -- an identity cache keyed by controller: a new controller swaps in a new owner object, never setState in render
  if (current.current.controller !== controller) current.current = { controller };
  // eslint-disable-next-line react-hooks/refs -- the owner token for this controller (see above); late results compare against it
  const owner = current.current;
  const [form, setForm] = useState({ owner, draftTitle: '', notice: '' });
  const draftTitle = form.owner === owner ? form.draftTitle : '';
  const notice = form.owner === owner ? form.notice : '';
  const updateForm = (patch: Partial<{ draftTitle: string; notice: string }>) => {
    if (current.current !== owner) return;
    setForm(previous => ({ ...(previous.owner === owner ? previous : { owner, draftTitle: '', notice: '' }), ...patch }));
  };
  const setDraftTitle = (value: string) => updateForm({ draftTitle: value });
  const setNotice = (value: string) => updateForm({ notice: value });
  const inputId = useId();
  const disabled = state.readOnly || state.lifecycle === 'disposed';
  const edit = (operations: readonly TaskListOperation[]) => {
    const result = controller.actions.edit(controller.actions.selection(), operations);
    setNotice(result.kind === 'applied' ? '' : `${result.kind}: ${result.reason}`);
    return result;
  };
  const run = async (action: () => Promise<ReadResult | SaveResult>) => {
    try {
      const result = await action();
      setNotice(result.kind === 'available' || result.kind === 'saved' ? ''
        : result.kind === 'missing' ? 'missing: Resource is missing'
        : `${result.kind}${'reason' in result ? `: ${result.reason}` : ''}`);
    }
    catch (error) { setNotice(String(error)); }
  };
  const save = state.save.kind === 'settled' ? state.save.result : undefined;
  // One flat surface on the canvas: no outline, no shadow, no card in a card. Rows are flat and wash on hover; the phone row is a 44px target.
  return <section className={['boring-task-list-recipe flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] bg-card p-3 text-card-foreground', className].filter(Boolean).join(' ')} data-boring="task-list-viewer">
    <h2 className="m-0 text-sm font-semibold">{title}</h2>
    <p role="status" aria-live="polite" className={`m-0 font-mono text-xs ${state.lifecycle === 'disposed' || notice ? 'text-destructive' : state.dirty ? 'text-foreground' : 'text-muted-foreground'}`}>{state.lifecycle === 'disposed' ? 'Closed' : state.readOnly ? 'Read only' : state.dirty ? 'Unsaved changes' : 'Saved'}
      {state.save.kind === 'pending' ? ' · Saving' : save ? ` · ${save.kind}${'reason' in save ? `: ${save.reason}` : ''}` : ''}
      {state.remote ? ' · Remote changes available' : ''}</p>
    <ul className="m-0 flex list-none flex-col p-0">{state.document.items.map(item => <li key={item.id} data-task-id={item.id}
      className="flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] px-2 hover:bg-muted sm:min-h-8">
      <label className={`flex min-w-0 flex-1 items-center gap-2 text-xs ${item.completed ? 'text-muted-foreground line-through' : ''}`}><Checkbox aria-label={`Complete ${item.title}`} checked={item.completed} disabled={disabled}
        onCheckedChange={completed => edit([{ kind: 'set-completed', id: item.id, completed }])} /><span className="min-w-0 truncate">{item.title}</span></label>
      <Button variant="ghost" size="sm" aria-label={`Remove ${item.title}`} disabled={disabled} onClick={() => edit([{ kind: 'remove', id: item.id }])}>Remove</Button>
    </li>)}</ul>
    <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); if (edit([{ kind: 'add', id: randomUUID(), title: draftTitle }]).kind === 'applied') setDraftTitle(''); }}>
      <label htmlFor={inputId} className="sr-only">New task</label><Input id={inputId} className="min-h-11 min-w-0 flex-1 sm:min-h-8" value={draftTitle} disabled={disabled} onChange={event => setDraftTitle(event.target.value)} />
      <Button variant="default" type="submit" className="min-h-11 sm:min-h-8" disabled={disabled || !draftTitle.trim()}>Add task</Button>
    </form>
    <div className="flex flex-wrap gap-1">
      <Button variant="default" disabled={disabled || !state.dirty || state.save.kind === 'pending'} onClick={() => void run(() => controller.flush(controller.actions.selection()))}>Save</Button>
      <Button variant="ghost" disabled={state.lifecycle === 'disposed'} onClick={() => void run(controller.actions.refresh)}>Refresh</Button>
      <Button variant="ghost" disabled={disabled || (!state.dirty && !state.remote)} onClick={() => void run(controller.actions.discardToRemote)}>Discard</Button>
      <Button variant="ghost" disabled={state.lifecycle === 'disposed' || save?.kind !== 'unknown'} onClick={() => void run(controller.actions.reconcile)}>Reconcile</Button>
      <Button variant="ghost" disabled={state.lifecycle === 'disposed' || save?.kind !== 'unknown'} onClick={() => void run(controller.actions.abandon)}>Abandon save</Button>
    </div>
    {notice && <p role="alert" className="m-0 text-xs text-destructive">{notice}</p>}
  </section>;
}
