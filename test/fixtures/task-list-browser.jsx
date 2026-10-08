import { randomUUID } from '@hachej/boring-files/platform';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import { createTaskListFeature } from '../../registry/task-list-viewer/task-list-controller';
import { TaskListViewer } from '../../registry/task-list-viewer/task-list-viewer';

const identity = { scopeId: 'fictional', principalId: 'browser', initiatorId: 'journey' };
const target = { resource: { providerId: 'tasks', path: 'tasks.json' }, view: { kind: 'published' } };
const notesTarget = { resource: { providerId: 'notes', path: 'notes.md' }, view: { kind: 'published' } };
const root = createRoot(document.getElementById('root'));
let fixture, release;
const faults = { held: false, hold: false, lost: false };
const authenticated = async request => {
  const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-browser');
  const body = request.method === 'POST' ? JSON.parse(await request.clone().text()) : null;
  const response = await fetch(new Request(request, { headers }));
  if (new URL(request.url).pathname === '/tasks' && request.method === 'POST') {
    if (body.kind === 'publish') {
      if (faults.hold) { faults.hold = false; faults.held = true; await new Promise(resolve => { release = resolve; }); faults.held = false; }
      if (faults.lost) { faults.lost = false; throw new Error('Fictional lost publication acknowledgement'); }
    }
  }
  return response;
};
const client = endpoint => createResourceClient({ identity, endpoint: new URL(endpoint, location.href), publication: true, reconciliation: true, fetch: authenticated });
const tasks = client('/tasks'), notes = client('/notes');
async function mount(readOnly = false) {
  flushSync(() => root.render(null));
  await fixture?.controller.dispose(); await fixture?.markdown.dispose();
  const saved = await tasks.read({ target, revision: { kind: 'latest' } });
  const note = await notes.read({ target: notesTarget, revision: { kind: 'latest' } });
  if (saved.kind !== 'available' || note.kind !== 'available') throw new Error('Fictional resources unavailable');
  const options = { identity, client: tasks, instanceId: randomUUID(), epoch: 'browser', source: { kind: 'saved', snapshot: saved.snapshot }, readOnly };
  const feature = createTaskListFeature(options);
  const controller = feature.createController({ kind: 'fictional.task-list', version: 1, source: target });
  const markdown = createMarkdownController({ identity, client: notes, instanceId: randomUUID(), epoch: 'browser', source: { kind: 'saved', snapshot: note.snapshot } });
  fixture = { controller, markdown, feature, options };
  flushSync(() => root.render(<main><TaskListViewer controller={controller} title="Fictional checklist" /><MarkdownEditor controller={markdown} initialMode="source" title="Independent notes" /></main>));
}
window.taskList = {
  mount, faults, get fixture() { return fixture; }, state: () => fixture.controller.getSnapshot(),
  release: () => { release?.(); release = undefined; },
  async detachTasks() { flushSync(() => root.render(<MarkdownEditor controller={fixture.markdown} initialMode="source" title="Independent notes" />)); await fixture.controller.dispose(); },
  async compositionChecks() {
    const installed = new Map([['fictional.task-list', fixture.controller]]), attached = [];
    const install = async entries => {
      const added = [];
      try {
        for (const [kind, feature, descriptor] of entries) {
          if (installed.has(kind)) throw new Error('Viewer collision');
          const controller = feature.createController(descriptor);
          installed.set(kind, controller); added.push([kind, controller]); attached.push(controller);
        }
      } catch (error) { for (const [kind, controller] of added) { installed.delete(kind); await controller.dispose(); } throw error; }
    };
    const errors = [];
    const descriptor = { kind: 'fictional.task-list', version: 1, source: target };
    const temporaryFeature = createTaskListFeature({ ...fixture.options, instanceId: randomUUID() });
    try { await install([['temporary', temporaryFeature, descriptor], ['fictional.task-list', fixture.feature, descriptor]]); } catch (error) { errors.push(String(error)); }
    for (const invalid of [{ ...descriptor, version: 2 }, { ...descriptor, source: notesTarget }]) {
      let refused = false;
      try { await install([['invalid', fixture.feature, invalid]]); } catch (error) { refused = true; errors.push(String(error)); }
      if (!refused) throw new Error('Invalid descriptor accepted');
    }
    return { keys: [...installed.keys()], failures: errors, rolledBack: attached.map(controller => controller.getSnapshot().lifecycle), taskActive: fixture.controller.getSnapshot().lifecycle, notesActive: fixture.markdown.getSnapshot().lifecycle };
  },
};
mount().catch(error => { document.body.textContent = String(error); throw error; });
