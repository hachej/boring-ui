// Pi 1.0.3 reads files through positional readers (`openBinaryReader().scanLines()`, used by Pi's `read` tool), pages directories
// (`openDirReader`) and watches for changes. The SQLite workspace must answer exactly like Pi's own Node environment.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';

const value = result => { assert.equal(result.ok, true, result.ok ? '' : result.error.message); return result.value; };
const SAMPLES = {
  empty: new Uint8Array(),
  plain: new TextEncoder().encode('one\ntwo\nthree'),
  trailing: new TextEncoder().encode('one\ntwo\n'),
  bom: new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('é\n€ x\n﻿later bom')]),
  crlf: new TextEncoder().encode('a\r\nbb\r\n\r\nccc'),
  invalid: new Uint8Array([0x61, 0xff, 0x0a, 0xc3, 0x0a, 0x62]),
};
const RANGES = [[0], [0, 1], [1], [1, 2], [2, 4], [5], [0, 10], [3, 4]];

function sqlite(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-readers-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return openSqliteFileSystem({ connection: openNodeConnection(join(directory, 'files.sqlite')), workspace: 'fictional', cwd: '/workspace' });
}

test('SQLite positional readers scan lines exactly like Pi NodeExecutionEnv', async t => {
  const fs = sqlite(t);
  const directory = mkdtempSync(join(tmpdir(), 'boring-readers-node-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const node = new NodeExecutionEnv({ cwd: directory });
  for (const [name, bytes] of Object.entries(SAMPLES)) {
    writeFileSync(join(directory, name), bytes);
    value(await fs.writeFile(`/workspace/${name}`, bytes, context));
    const ours = value(await fs.openBinaryReader(`/workspace/${name}`, undefined, context)), theirs = value(await node.openBinaryReader(join(directory, name), undefined, context));
    assert.equal(value(await ours.info(context)).size, bytes.length);
    assert.deepEqual(value(await ours.read(1, 3, context)), value(await theirs.read(1, 3, context)), name);
    for (const [startLine, endLine] of RANGES) {
      const options = endLine === undefined ? { startLine } : { startLine, endLine };
      assert.deepEqual(value(await ours.scanLines(options, context)), value(await theirs.scanLines(options, context)), `${name} ${JSON.stringify(options)}`);
    }
    await ours.close(context); await theirs.close(context);
  }
  const bad = value(await fs.openBinaryReader('/workspace/plain', undefined, context));
  assert.equal((await bad.scanLines({ startLine: 2, endLine: 1 }, context)).error.code, 'invalid');
  assert.equal((await fs.openBinaryReader('/workspace', undefined, context)).error.code, 'is_directory');
  assert.equal((await fs.openBinaryReader('/workspace/absent', undefined, context)).error.code, 'not_found');
  // The reader keeps the file as it was when opened.
  const held = value(await fs.openBinaryReader('/workspace/plain', undefined, context));
  value(await fs.writeFile('/workspace/plain', 'changed', context));
  assert.equal(new TextDecoder().decode(value(await held.read(0, 3, context))), 'one');
});

test('SQLite directory readers page every entry once', async t => {
  const fs = sqlite(t);
  for (const name of ['a', 'b', 'c', 'd', 'e']) value(await fs.writeFile(`/workspace/dir/${name}.txt`, name, context));
  value(await fs.createDir('/workspace/dir/sub', undefined, context));
  const reader = value(await fs.openDirReader('/workspace/dir', context));
  const seen = [];
  for (;;) { const page = value(await reader.next(2, context)); seen.push(...page.entries.map(entry => `${entry.kind}:${entry.name}`)); assert.ok(page.entries.length <= 2); if (page.done) break; }
  assert.deepEqual(seen.sort(), ['directory:sub', 'file:a.txt', 'file:b.txt', 'file:c.txt', 'file:d.txt', 'file:e.txt']);
  assert.equal((await fs.openDirReader('/workspace/dir/a.txt', context)).error.code, 'not_directory');
});

test('SQLite watchers report created, changed and removed paths, honour excludes, and stop when closed', async t => {
  const fs = sqlite(t);
  value(await fs.createDir('/workspace/docs', undefined, context));
  const changes = [];
  const watcher = value(await fs.watch([{ path: '/workspace/docs', recursive: true, exclude: { hidden: true, names: ['node_modules'] } }, { path: '/workspace/later.md' }], change => changes.push(change), context));
  assert.equal(watcher.mode, 'polling');
  value(await fs.writeFile('/workspace/docs/deep/note.md', 'x', context));
  value(await fs.writeFile('/workspace/docs/.hidden', 'x', context));
  value(await fs.writeFile('/workspace/docs/node_modules/pkg.js', 'x', context));
  value(await fs.writeFile('/workspace/later.md', 'created after watching', context));
  const until = async predicate => { for (let n = 0; n < 40 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 100)); };
  await until(() => changes.flatMap(change => change.paths ?? []).includes('/workspace/later.md'));
  const paths = changes.flatMap(change => change.paths ?? []);
  assert.ok(paths.includes('/workspace/docs/deep/note.md'));
  assert.ok(paths.includes('/workspace/later.md'), 'a missing target that appears is a change');
  assert.ok(!paths.some(path => path.includes('.hidden') || path.includes('node_modules')), 'excluded names are not reported');
  value(await fs.remove('/workspace/docs/deep', { recursive: true }, context));
  await until(() => changes.flatMap(change => change.paths ?? []).filter(path => path.startsWith('/workspace/docs/deep')).length >= 3);
  await watcher.close(context);
  const count = changes.length;
  value(await fs.writeFile('/workspace/docs/after-close.md', 'x', context));
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(changes.length, count, 'no call after close');
});

// Some SQLite engines hand back no bytes for a zero-length BLOB: the C API reports a NULL pointer, and the browser's Wasm build and
// some Durable Object bindings return null. A file row with no bytes is an empty file, and every read must treat it that way.
function nullForEmptyBlobs(connection) {
  const nulled = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array && value.length === 0 ? null : value]));
  return { ...connection, get: (sql, ...params) => nulled(connection.get(sql, ...params)), all: (sql, ...params) => connection.all(sql, ...params).map(nulled) };
}

test('SQLite file system reads zero-length files when the engine returns no bytes for an empty BLOB', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-readers-empty-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fs = openSqliteFileSystem({ connection: nullForEmptyBlobs(openNodeConnection(join(directory, 'files.sqlite'))), workspace: 'fictional', cwd: '/workspace' });
  value(await fs.writeFile('/workspace/.gitignore', new Uint8Array(), context));
  value(await fs.writeFile('/workspace/.git/info/exclude', new Uint8Array(), context));
  value(await fs.writeFile('/workspace/src/app.txt', 'needle\n', context));

  assert.deepEqual(value(await fs.readBinaryFile('/workspace/.gitignore', context)), new Uint8Array());
  assert.equal(value(await fs.readTextFile('/workspace/.gitignore', context)), '');
  assert.equal(value(await fs.fileInfo('/workspace/.gitignore', context)).size, 0);
  assert.deepEqual(value(await fs.listDir('/workspace', context)).filter(entry => entry.name === '.gitignore').map(entry => [entry.kind, entry.size]), [['file', 0]]);

  const workspace = createVirtualWorkspace({ providerId: 'fictional-sqlite-empty', fs });
  t.after(() => workspace.dispose());
  const shell = workspace.createBash({ cwd: '/workspace' });
  assert.equal((await shell.exec('cat .gitignore')).exitCode, 0);
  const search = await shell.exec('grep -r needle /workspace');
  assert.equal(search.exitCode, 0, search.stderr);
  assert.equal(search.stdout, '/workspace/src/app.txt:needle\n');
});
