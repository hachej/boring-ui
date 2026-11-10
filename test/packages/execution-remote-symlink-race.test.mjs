// D-2087: the Code Interpreter env maps interpreter paths onto this host's mount of the same folder, and code in the
// interpreter writes that folder too. It can swap a directory the host checked for a symbolic link to somewhere else
// between the check and the open. A host read or write must never land outside the folder, whatever the timing.
// Fictional files only, in this test's own temporary directory.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
