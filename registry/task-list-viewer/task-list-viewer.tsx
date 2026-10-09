'use client';

import { randomUUID } from '@hachej/boring-files/platform';
import React, { useId, useRef, useState, useSyncExternalStore } from 'react';
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
  const current = useRef({ controller });
  if (current.current.controller !== controller) current.current = { controller };
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
  return <section className={['boring-task-list-recipe', className].filter(Boolean).join(' ')} data-boring="task-list-viewer">
    <h2>{title}</h2>
    <p role="status" aria-live="polite">{state.lifecycle === 'disposed' ? 'Closed' : state.readOnly ? 'Read only' : state.dirty ? 'Unsaved changes' : 'Saved'}
      {state.save.kind === 'pending' ? ' · Saving' : save ? ` · ${save.kind}${'reason' in save ? `: ${save.reason}` : ''}` : ''}
      {state.remote ? ' · Remote changes available' : ''}</p>
    <ul>{state.document.items.map(item => <li key={item.id} data-task-id={item.id}>
      <label><input type="checkbox" aria-label={`Complete ${item.title}`} checked={item.completed} disabled={disabled}
        onChange={event => edit([{ kind: 'set-completed', id: item.id, completed: event.target.checked }])} />{item.title}</label>
      <button type="button" aria-label={`Remove ${item.title}`} disabled={disabled} onClick={() => edit([{ kind: 'remove', id: item.id }])}>Remove</button>
    </li>)}</ul>
    <form onSubmit={event => { event.preventDefault(); if (edit([{ kind: 'add', id: randomUUID(), title: draftTitle }]).kind === 'applied') setDraftTitle(''); }}>
      <label htmlFor={inputId}>New task</label><input id={inputId} value={draftTitle} disabled={disabled} onChange={event => setDraftTitle(event.target.value)} />
      <button type="submit" disabled={disabled || !draftTitle.trim()}>Add task</button>
    </form>
    <div className="boring-task-list-actions">
      <button type="button" disabled={disabled || !state.dirty || state.save.kind === 'pending'} onClick={() => void run(() => controller.flush(controller.actions.selection()))}>Save</button>
      <button type="button" disabled={state.lifecycle === 'disposed'} onClick={() => void run(controller.actions.refresh)}>Refresh</button>
      <button type="button" disabled={disabled || (!state.dirty && !state.remote)} onClick={() => void run(controller.actions.discardToRemote)}>Discard</button>
      <button type="button" disabled={state.lifecycle === 'disposed' || save?.kind !== 'unknown'} onClick={() => void run(controller.actions.reconcile)}>Reconcile</button>
      <button type="button" disabled={state.lifecycle === 'disposed' || save?.kind !== 'unknown'} onClick={() => void run(controller.actions.abandon)}>Abandon save</button>
    </div>
    {notice && <p role="alert">{notice}</p>}
  </section>;
}
