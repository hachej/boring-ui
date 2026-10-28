import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

test('optional task catalog searches id/title, marks waiting, composes file search/kinds and opens only authorized task chips', async () => {
  const out = resolve('.cache/task-mentions-test'); mkdirSync(out, { recursive: true });
  const outfile = `${out}/mentions.mjs`;
  await build({ entryPoints: ['registry/task-mentions/task-mentions.tsx'], outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', alias: { '@': resolve('examples/app-shell') }, logLevel: 'silent' });
  const { taskMentions } = await import(pathToFileURL(outfile));
  const opened = [], calls = [];
  const tasks = [{ id: 'D-201', title: 'Fictional picnic', state: 'waiting', waiting_on_you: true }, { id: 'D-202', title: 'Fictional map', state: 'working' }];
  const custom = { label: id => id, icon: null };
  const base = { kinds: { person: custom }, search: async (query, signal) => { calls.push([query, signal]); return [{ path: 'docs/brief.md' }]; }, open: () => {}, generation: 7 };
  const config = taskMentions({ tasks, onOpen: task => opened.push(task.id), base });
  const abort = new AbortController();
  assert.deepEqual((await config.search('picnic', abort.signal)).map(item => item.path), ['task:D-201', 'docs/brief.md']);
  assert.match((await config.search('201', abort.signal))[0].label, /D-201.*Waiting on you/);
  assert.equal(config.kinds.person, custom); assert.equal(config.open, base.open); assert.equal(config.generation, 7); assert.ok(config.Picker);
  assert.equal(calls[0][1], abort.signal);
  assert.equal(config.kinds.task.label('D-201'), '@ D-201 · Fictional picnic');
  config.kinds.task.open('D-201'); config.kinds.task.open('D-999'); assert.deepEqual(opened, ['D-201']);
  abort.abort(); assert.deepEqual(await config.search('', abort.signal), []);
});
