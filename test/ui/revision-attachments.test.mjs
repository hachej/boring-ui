// `useRevisionAttachments` (registry/pi-app/use-revision-attachments.ts) over a real SQLite revision provider, rendered in happy-dom: a bare
// hook with no Library tree saves through the provider under uploads/, a file over the host's limit is refused with the host's message, and a
// file outside `accept` is refused. Fictional files only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';

const access = { principalId: 'fictional-person', scopeId: 'fictional-scope', initiatorId: 'fictional-person' };

/** A real workspace provider over one SQLite file, reached through the revision handler exactly as a host serves it. */
function revisionFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-attachments-'));
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace' });
  const provider = createWorkspaceProvider({ fs, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' } });
  const handler = createRevisionHandler({ resolve: async () => ({ provider, access, release() {} }) });
  t.after(() => { db.close(); rmSync(directory, { force: true, recursive: true }); });
  return connectRevisionProvider({ endpoint: 'https://fictional.invalid/files', fetch: handler });
}

test('attachments saved through any revision provider: under uploads/, refused over the host limit or outside accept', async t => {
  const client = await revisionFixture(t);
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/revision-attachments-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('use-revision-attachments.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/use-revision-attachments.ts', import.meta.url).pathname], outfile: output.pathname, bundle: true,
    format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { useRevisionAttachments } = await import(output.href);

  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => { try { root.unmount(); } catch { /* already unmounted */ } }); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  // Renders the hook for one set of options and returns the config it produced; `failures` collects the partial failures it reports.
  const failures = [];
  let config;
  const Probe = options => { config = useRevisionAttachments({ ...options, onPreparationFailure: (name, reason) => failures.push([name, reason]) }); return null; };
  const render = async options => { await act(async () => root.render(createElement(Probe, options))); };
  const file = (name, bytes, type) => new window.File([bytes], name, { type });
  // Every file in the workspace under uploads/ (a listing of a directory that does not exist yet is refused by the provider).
  const saved = async () => (await client.search({ query: '' })).entries.map(entry => entry.path).filter(path => path.startsWith('uploads/'));

  await render({ revisionProvider: client, maxBytes: 16, tooLarge: 'Larger than 16 bytes. Not saved.' });
  // The tree is made in an effect, so the config appears after the first render commits.
  assert.ok(config?.upload, 'a bare hook gets an attachments config from the provider');

  await t.test('a file over the host limit is refused with the host message and nothing is saved', async () => {
    failures.length = 0;
    await assert.rejects(config.upload([file('too-big.txt', 'x'.repeat(40), 'text/plain')], new AbortController().signal), error => {
      assert.equal(error.message, 'Larger than 16 bytes. Not saved.');
      return true;
    });
    assert.deepEqual(failures, [['too-big.txt', 'Larger than 16 bytes. Not saved.']]);
    assert.deepEqual(await saved(), []);
  });

  await t.test('a file within the limit is written under uploads/ through the provider, the other one refused and reported', async () => {
    failures.length = 0;
    const results = await config.upload([file('notes.txt', 'short note', 'text/plain'), file('huge.txt', 'y'.repeat(99), 'text/plain')], new AbortController().signal);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'notes.txt');
    assert.match(results[0].path, /^uploads\/notes-[0-9a-f]{8}\.txt$/);
    assert.deepEqual(failures, [['huge.txt', 'Larger than 16 bytes. Not saved.']]);
    const read = await client.read({ target: client.locate(results[0].path), revision: { kind: 'latest' } });
    assert.equal(read.kind, 'available');
    assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'short note');
    assert.deepEqual(await saved(), [results[0].path]);
  });

  await t.test('only files of the accepted types are saved; the picker list is passed on as accept', async () => {
    await render({ revisionProvider: client, accept: 'image/*,.pdf' });
    assert.equal(config.accept, 'image/*,.pdf');
    failures.length = 0;
    const results = await config.upload([file('photo.png', 'png-bytes', 'image/png'), file('program.exe', 'binary', 'application/x-msdownload'),
      file('Report.PDF', 'pdf-bytes', 'application/pdf')], new AbortController().signal);
    assert.deepEqual(results.map(item => item.name), ['photo.png', 'Report.PDF']);
    assert.deepEqual(failures, [['program.exe', 'This file type is not accepted.']]);
    assert.ok(results.every(item => item.path.startsWith('uploads/')));
    await assert.rejects(config.upload([file('script.sh', 'echo', 'text/x-sh')], new AbortController().signal), error => error.message === 'This file type is not accepted.');
  });

  await t.test('with no provider there are no attachments', async () => {
    await render({});
    assert.equal(config, undefined);
  });
});
