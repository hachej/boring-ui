// D-2087: the Code Interpreter env maps interpreter paths onto this host's mount of the same folder, and code in the
// interpreter writes that folder too. It can swap a directory the host checked for a symbolic link to somewhere else
// between the check and the open. A host read or write must never land outside the folder, whatever the timing.
// Fictional files only, in this test's own temporary directory.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createCodeInterpreterEnv } from '@hachej/boring-execution/aws-code-interpreter';

const SECRET = 'fictional secret outside the workspace\n';

/** The public factory, as a host builds it; file tools never call the service, so the client only refuses. */
function open(root) {
  const client = { send: async () => { throw Object.assign(new Error('fictional: no service in this test'), { name: 'ValidationException' }); } };
  return createCodeInterpreterEnv({ client, codeInterpreterIdentifier: 'fictional', id: `efs:${root}`, session: { start: {} }, mount: { path: '/mnt/workspace', root } });
}

function layout(t) {
  const base = mkdtempSync(join(tmpdir(), 'boring-symlink-race-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'root'), outside = join(base, 'outside');
  mkdirSync(join(root, 'd'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'd', 'f'), 'inside\n');
  writeFileSync(join(outside, 'f'), SECRET);
  return { base, root, outside };
}

// The interpreter's side: `d` keeps flipping between the real directory and a link to the outside folder.
const SWAPPER = `
const { renameSync, rmSync, lstatSync, symlinkSync } = require('node:fs');
const { join } = require('node:path');
const root = process.argv[1], outside = process.argv[2], until = Date.now() + Number(process.argv[3]);
const at = name => join(root, name);
const tryIt = fn => { try { fn(); } catch {} };
symlinkSync(outside, at('d-link'));
process.stdout.write('ready\\n');
while (Date.now() < until) {
  // A directory the host created while d was briefly missing would stop the swap: drop it.
  tryIt(() => { if (lstatSync(at('d')).isDirectory() && lstatSync(at('d-real')).isDirectory()) rmSync(at('d'), { recursive: true, force: true }); });
  tryIt(() => renameSync(at('d'), at('d-real')));
  tryIt(() => renameSync(at('d-link'), at('d')));
  tryIt(() => renameSync(at('d'), at('d-link')));
  tryIt(() => renameSync(at('d-real'), at('d')));
}
`;

test('Code Interpreter env: a directory swapped for an outside link while the host reads and writes never leaks or changes the outside file', { timeout: 30000 }, async t => {
  const { root, outside } = layout(t);
  const { env } = open(root);
  const swapper = spawn(process.execPath, ['-e', SWAPPER, root, outside, '3000'], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => { if (swapper.exitCode === null) swapper.kill('SIGKILL'); });
  const exited = new Promise(resolve => swapper.once('exit', resolve));
  await new Promise((resolve, reject) => { swapper.stdout.once('data', resolve); swapper.once('error', reject); });

  // Reads first, then writes: a write that escaped would change what a later escaped read returns.
  let reads = 0, writes = 0, leaked = 0;
  const readUntil = Date.now() + 1400;
  while (Date.now() < readUntil && swapper.exitCode === null) {
    const read = await env.readTextFile('d/f', context);
    reads++;
    if (read.ok && read.value === SECRET) leaked++;
  }
  const writeUntil = Date.now() + 1400;
  while (Date.now() < writeUntil && swapper.exitCode === null) {
    await env.writeFile('d/f', 'written by the host\n', context);
    writes++;
  }
  await exited;

  assert.ok(reads > 50 && writes > 50, `the race ran (${reads} reads, ${writes} writes)`);
  assert.equal(leaked, 0, `no read returned the outside file (${leaked} of ${reads} did)`);
  assert.equal(readFileSync(join(outside, 'f'), 'utf8'), SECRET, 'the outside file was never written');
  assert.deepEqual(readdirSync(outside), ['f'], 'nothing was created outside');
});

/** Links of every kind: `esc` (a directory outside), `escf` (a file outside, absolute), `escr` (the same, relative), and links inside. */
function linked(t) {
  const paths = layout(t);
  const { root, outside } = paths;
  symlinkSync(outside, join(root, 'esc'));
  symlinkSync(join(outside, 'f'), join(root, 'escf'));
  symlinkSync('../outside/f', join(root, 'escr'));
  symlinkSync('d', join(root, 'in'));
  symlinkSync('d/f', join(root, 'inf'));
  symlinkSync(join(root, 'd', 'f'), join(root, 'absf'));
  return paths;
}

const unchanged = outside => {
  assert.equal(readFileSync(join(outside, 'f'), 'utf8'), SECRET, 'the outside file is unchanged');
  assert.deepEqual(readdirSync(outside), ['f'], 'nothing was created or moved outside');
};

test('Code Interpreter env: a link to outside, as a directory on the way or as the file itself, is refused by every operation', async t => {
  const { root, outside } = linked(t);
  const { env } = open(root);
  const operations = path => ({
    readTextFile: () => env.readTextFile(path, context),
    readBinaryFile: () => env.readBinaryFile(path, context),
    readTextLines: () => env.readTextLines(path, undefined, context),
    openTextLineReader: () => env.openTextLineReader(path, context),
    openBinaryReader: () => env.openBinaryReader(path, undefined, context),
    writeFile: () => env.writeFile(path, 'written by the host\n', context),
    appendFile: () => env.appendFile(path, 'appended by the host\n', context),
    truncateFile: () => env.truncateFile(path, 0, context),
    flushFile: () => env.flushFile(path, context),
    canonicalPath: () => env.canonicalPath(path, context),
    watch: () => env.watch([{ path }], () => {}, context),
  });
  for (const path of ['esc/f', 'escf', 'escr']) {
    for (const [name, run] of Object.entries(operations(path))) {
      const result = await run();
      assert.equal(result.ok, false, `${name}(${path}) is refused`);
      assert.equal(result.error.code, 'permission_denied', `${name}(${path}): ${result.error.message}`);
    }
  }
  // Through the outside directory: listing, creating, describing, moving in or out, removing.
  const throughDirectory = {
    listDir: () => env.listDir('esc', context),
    openDirReader: () => env.openDirReader('esc', context),
    createDir: () => env.createDir('esc/made', undefined, context),
    fileInfo: () => env.fileInfo('esc/f', context),
    exists: () => env.exists('esc/f', context),
    renameOut: () => env.renameFile('esc/f', 'stolen', context),
    renameIn: () => env.renameFile('d/f', 'esc/planted', context),
    remove: () => env.remove('esc/f', { force: true }, context),
    openBinaryReaderNoFollow: () => env.openBinaryReader('esc/f', { noFollow: true }, context),
  };
  for (const [name, run] of Object.entries(throughDirectory)) {
    const result = await run();
    assert.equal(result.ok, false, `${name} through esc is refused`);
    assert.equal(result.error.code, 'permission_denied', `${name}: ${result.error.message}`);
  }
  const noFollow = await env.openBinaryReader('escf', { noFollow: true }, context);
  assert.equal(noFollow.ok ? 'opened' : noFollow.error.code, 'invalid', 'noFollow on a final link refuses to follow it');
  unchanged(outside);
});

test('Code Interpreter env: a final link to outside is described, moved and removed as a link, never followed', async t => {
  const { root, outside } = linked(t);
  const { env } = open(root);
  const info = await env.fileInfo('escf', context);
  assert.equal(info.ok && info.value.kind, 'symlink');
  assert.equal((await env.renameFile('escf', 'moved', context)).ok, true, 'renaming a link renames the link');
  assert.equal(lstatSync(join(root, 'moved')).isSymbolicLink(), true);
  assert.equal((await env.remove('moved', undefined, context)).ok, true, 'removing a link removes the link');
  assert.equal((await env.remove('esc', { recursive: true }, context)).ok, true, 'a recursive remove of a link removes only the link');
  assert.equal(existsSync(join(root, 'moved')) || existsSync(join(root, 'esc')), false);
  unchanged(outside);
});

test('Code Interpreter env: links that stay inside the folder still resolve where the operation follows links', async t => {
  const { root, outside } = linked(t);
  const { env } = open(root);
  for (const path of ['in/f', 'inf', 'absf']) {
    const read = await env.readTextFile(path, context);
    assert.equal(read.ok && read.value, 'inside\n', `read ${path}`);
  }
  assert.equal((await env.writeFile('inf', 'through a link\n', context)).ok, true);
  assert.equal(readFileSync(join(root, 'd', 'f'), 'utf8'), 'through a link\n', 'a write through an inside link lands on its target');
  assert.equal(lstatSync(join(root, 'inf')).isSymbolicLink(), true, 'the link itself stays a link');
  assert.equal((await env.writeFile('in/new.md', 'new\n', context)).ok, true);
  assert.equal(readFileSync(join(root, 'd', 'new.md'), 'utf8'), 'new\n');
  const canonical = await env.canonicalPath('inf', context);
  assert.equal(canonical.ok && canonical.value, '/mnt/workspace/d/f');
  const absolute = await env.canonicalPath('absf', context);
  assert.equal(absolute.ok && absolute.value, '/mnt/workspace/d/f');
  const listed = await env.listDir('in', context);
  assert.deepEqual(listed.ok && listed.value.map(entry => entry.path).sort(), ['/mnt/workspace/in/f', '/mnt/workspace/in/new.md']);
  const reader = await env.openBinaryReader('in/f', { noFollow: true }, context);
  assert.equal(reader.ok, true, 'noFollow refuses only a final link, not a link on the way inside the folder');
  if (reader.ok) await reader.value.close(context);
  assert.equal((await env.createDir('in/sub', undefined, context)).ok, true);
  assert.equal(lstatSync(join(root, 'd', 'sub')).isDirectory(), true);
  unchanged(outside);
});

/** Waits until `seen()` holds, failing after `ms`. */
async function until(seen, ms, label) {
  const end = Date.now() + ms;
  while (!seen()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('Code Interpreter env: a watch never reports names from outside, before or after a watched directory is swapped for a link', { timeout: 20000 }, async t => {
  const { root, outside } = linked(t);
  const { env } = open(root);
  const refused = await env.watch([{ path: 'esc', recursive: true }], () => {}, context);
  assert.equal(refused.ok ? 'watching' : refused.error.code, 'permission_denied', 'a link to an outside directory is refused for watch');

  const reported = [];
  const watcher = await env.watch([{ path: 'd', recursive: true }, { path: '.', recursive: true }], change => { if (change.paths) reported.push(...change.paths); }, context);
  assert.equal(watcher.ok, true, 'watching the folder');
  t.after(() => watcher.ok && watcher.value.close());

  // The interpreter swaps `d` for a link to the outside folder, then names appear and change out there.
  renameSync(join(root, 'd'), join(root, 'd-real'));
  symlinkSync(outside, join(root, 'd'));
  await until(() => reported.includes('/mnt/workspace/d'), 5000, 'the swap of d to be reported');
  writeFileSync(join(outside, 'fictional-private-name'), 'fictional\n');
  writeFileSync(join(outside, 'f'), 'fictional change outside\n');
  // A change inside, after the outside ones, shows the watcher is still live; then wait past the next periodic scan.
  writeFileSync(join(root, 'd-real', 'after'), 'inside\n');
  await until(() => reported.includes('/mnt/workspace/d-real/after'), 5000, 'a later change inside to be reported');
  await new Promise(resolve => setTimeout(resolve, 2500));

  const escaped = reported.filter(path => !path.startsWith('/mnt/workspace/') || path.includes('fictional-private-name'));
  assert.deepEqual(escaped, [], `no reported name came from outside (${reported.length} reported)`);
});
