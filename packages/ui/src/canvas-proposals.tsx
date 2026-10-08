'use client';

import { useMemo } from 'react';
import { useValue } from '@tldraw/editor';
import type { Editor } from '@tldraw/editor';
import type { CanvasController, CanvasProposal, CanvasState } from './canvas.js';
import type { SaveResult } from './resources.js';
import { sameBase } from './text-buffer.js';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function changedFields(before: unknown, after: unknown, path = ''): { field: string; before: string; after: string }[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if ((object(before) || before === undefined) && (object(after) || after === undefined)) {
    const left = object(before) ? before : {}, right = object(after) ? after : {};
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    if (keys.length) return keys.flatMap(key => changedFields(Object.hasOwn(left, key) ? left[key] : undefined,
      Object.hasOwn(right, key) ? right[key] : undefined, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`));
  }
  return [{ field: path || 'Record', before: before === undefined ? 'Absent' : JSON.stringify(before), after: after === undefined ? 'Absent' : JSON.stringify(after) }];
}
function ProposalChanges({ proposal }: { readonly proposal: CanvasProposal }) {
  const changes = useMemo(() => {
    const before = new Map(Object.values(proposal.before.store).map(record => [String(record.id), record]));
    const after = new Map(Object.values(proposal.after.store).map(record => [String(record.id), record]));
    return [...new Set([...before.keys(), ...after.keys()])].flatMap(id => {
      const fields = changedFields(before.get(id), after.get(id));
      return fields.length ? [{ id, kind: !before.has(id) ? 'Added' : !after.has(id) ? 'Removed' : 'Changed', fields }] : [];
    });
  }, [proposal]);
  return <details><summary>Review {changes.length} changed {changes.length === 1 ? 'record' : 'records'}</summary>
    {changes.map(change => <div key={change.id}>
      <h4>{change.kind}: {change.id}</h4>
      <table><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>{change.fields.map(row => <tr key={row.field}><th scope="row">{row.field}</th>
          <td><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.before}</pre></td>
          <td><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.after}</pre></td></tr>)}</tbody>
      </table>
    </div>)}
  </details>;
}

export function CanvasProposals({ controller, state, editor, busy, run }: {
  readonly controller: CanvasController;
  readonly state: CanvasState;
  readonly editor: Editor | null;
  readonly busy: boolean;
  readonly run: (action: () => Promise<SaveResult>) => Promise<void>;
}) {
  const nativeReadOnly = useValue('canvas proposal readonly', () => !editor || editor.isDisposed || editor.getIsReadonly(), [editor]);
  const blocked = busy || nativeReadOnly || state.readOnly || state.lifecycle !== 'active' || state.problem !== null
    || state.save.kind === 'pending' || (state.save.kind === 'settled' && state.save.result.kind === 'unknown');
  if (!state.proposals.length) return null;
  return <aside aria-label="Canvas proposals">
    {state.proposals.map(proposal => {
      const stale = state.bufferVersion !== proposal.base.target.subject.bufferVersion || !sameBase(state.base, proposal.base.target.subject.base);
      return <article key={proposal.id} data-boring="canvas-proposal">
        <h3>{proposal.summary || 'Canvas change proposal'}</h3>
        <ProposalChanges proposal={proposal} />
        {proposal.adopted ? <p>Applied locally. Publication status is shown above.</p> : stale ? <p>Canvas changed since this proposal.</p> : null}
        {!proposal.adopted && <button type="button" disabled={blocked || stale} onClick={() => {
          if (!editor || editor.isDisposed || editor.getIsReadonly()) return;
          void run(() => controller.actions.accept(proposal.id));
        }}>Accept and save</button>}
        <button type="button" disabled={busy || state.lifecycle !== 'active'} onClick={() => controller.actions.reject(proposal.id)}>Dismiss</button>
      </article>;
    })}
  </aside>;
}
