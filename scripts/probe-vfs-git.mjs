// Standalone feasibility probe, not a Boring provider or production Git adapter.
// Pass an isolated directory containing just-bash@3.6.0 and isomorphic-git@1.42.6.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

assert.ok(process.argv[2], 'usage: node scripts/probe-vfs-git.mjs <isolated-dependency-directory>');
let processCalls = 0;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = () => { processCalls++; throw new Error(`native process denied: ${name}`); };
}
syncBuiltinESMExports();
globalThis.fetch = () => { throw new Error('network denied in local-Git probe'); };
const require = createRequire(resolve(process.argv[2], 'package.json'));
const { Bash, InMemoryFs, defineCommand } = require('just-bash');
const git = require('isomorphic-git');
const vfs = new InMemoryFs({ '/repo/note.txt': 'first\n', '/repo/data.bin': new Uint8Array([0, 255, 1]) });

function gitFs(vfs) {
  const wrap = (fn) => async (...args) => {
    try { return await fn(...args); } catch (error) {
      const code = /\b(ENOENT|EEXIST|ENOTDIR|EISDIR|ENOTEMPTY)\b/.exec(error.message)?.[1];
      if (code) error.code = code;
      throw error;
    }
  };
  const stat = (s) => ({
    ...s, isFile: () => s.isFile, isDirectory: () => s.isDirectory,
    isSymbolicLink: () => s.isSymbolicLink, mtimeMs: s.mtime.getTime(),
    ctime: s.mtime, ctimeMs: s.mtime.getTime(), uid: 0, gid: 0, dev: s.dev ?? 0, ino: s.ino ?? 0,
  });
  return { promises: {
    readFile: wrap(async (path, options) => {
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? vfs.readFile(path, encoding) : Buffer.from(await vfs.readFileBuffer(path));
    }),
    writeFile: wrap((path, bytes) => vfs.writeFile(path, bytes)),
    unlink: wrap((path) => vfs.rm(path)), readdir: wrap((path) => vfs.readdir(path)),
    mkdir: wrap((path, options) => vfs.mkdir(path, typeof options === 'object' ? options : {})),
    rmdir: wrap((path) => vfs.rm(path)),
    stat: wrap(async (path) => stat(await vfs.stat(path))),
    lstat: wrap(async (path) => stat(await vfs.lstat(path))),
    readlink: wrap((path) => vfs.readlink(path)), symlink: wrap((target, path) => vfs.symlink(target, path)),
    chmod: wrap((path, mode) => vfs.chmod(path, mode)),
  } };
}

const fs = gitFs(vfs);
const repo = { fs, dir: '/repo' };
const author = { name: 'Invented probe author', email: 'probe@example.invalid' };
await git.init({ ...repo, defaultBranch: 'main' });
await git.add({ ...repo, filepath: 'note.txt' });
await git.add({ ...repo, filepath: 'data.bin' });
const first = await git.commit({ ...repo, author, message: 'initial virtual commit' });
assert.equal(await git.status({ ...repo, filepath: 'note.txt' }), 'unmodified');
await git.branch({ ...repo, ref: 'feature' });
await git.checkout({ ...repo, ref: 'feature' });
// Narrow installed command facade: scratch feasibility, not a PM permission boundary.
// A production provider must also guard .git writes through ordinary file/Bash paths.
const gitCommand = defineCommand('git', async (args, ctx) => {
  // just-bash supplies a context FS facade; prove shared bytes, not object identity.
  assert.equal(await ctx.fs.readFile('/repo/note.txt'), await vfs.readFile('/repo/note.txt'));
  if (ctx.cwd !== '/repo') return { stdout: '', stderr: 'outside assigned probe repo\n', exitCode: 126 };
  const commandRepo = {fs: gitFs(ctx.fs), dir: ctx.cwd};
  if (args.length === 1 && args[0] === 'status') return { stdout: JSON.stringify(await git.statusMatrix(commandRepo)) + '\n', stderr: '', exitCode: 0 };
  if (args[0] === 'log' && (args.length === 1 || (args.length === 2 && args[1] === '-5'))) return { stdout: JSON.stringify(await git.log({...commandRepo, depth: 5})) + '\n', stderr: '', exitCode: 0 };
  return { stdout: '', stderr: 'unsupported/ungranted probe git subcommand\n', exitCode: 126 };
});
const shell = new Bash({ fs: vfs, cwd: '/repo', customCommands: [gitCommand] });
assert.equal((await shell.exec('printf "second\\n" > note.txt')).exitCode, 0);
assert.equal(await git.status({ ...repo, filepath: 'note.txt' }), '*modified');
const statusResult = await shell.exec('git status');
assert.equal(statusResult.exitCode, 0, statusResult.stderr);
assert.equal(JSON.parse(statusResult.stdout).find(([path]) => path === 'note.txt')[2], 2);
assert.equal((await shell.exec('git push')).exitCode, 126);
assert.equal((await shell.exec('not-a-virtual-command')).exitCode, 127);
await git.add({ ...repo, filepath: 'note.txt' });
await git.commit({ ...repo, author, message: 'virtual shell edit' });
assert.equal((await git.log({ ...repo })).length, 2);
const logResult = await shell.exec('git log -5');
assert.equal(logResult.exitCode, 0, logResult.stderr);
assert.equal(JSON.parse(logResult.stdout).length, 2);
await git.checkout({ ...repo, ref: 'main' });
assert.equal((await shell.exec('cat note.txt')).stdout, 'first\n');
assert.equal((await git.log({ ...repo }))[0].oid, first);
assert.deepEqual(await vfs.readFileBuffer('/repo/data.bin'), new Uint8Array([0, 255, 1]));
const files = {};
for (const path of vfs.getAllPaths()) {
  if ((await vfs.lstat(path)).isFile) files[path] = await vfs.readFileBuffer(path);
}
const restored = new InMemoryFs(files);
assert.equal((await git.log({ fs: gitFs(restored), dir: '/repo' }))[0].oid, first);
assert.equal(processCalls, 0);
console.log('PASS: VFS Git init/add/commit/status/log/branch/checkout; binary bytes preserved.');
console.log('PASS: installed git status/log command and direct Git/Bash share files; ungranted/unknown commands do not fall back; native process calls=0.');
console.log('PASS: file snapshot reconstruction retains history. Command whitelist alone is not a .git metadata/write authority proof.');
console.log('Scope: isolated in-memory feasibility, not durable provider/CAS/receipt/recovery or remote-network certification.');
