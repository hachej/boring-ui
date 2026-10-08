// Variant `local` (the default): a sandboxed in-memory just-bash workspace that is also a git repository (isomorphic-git over
// the same view; no native git, no second checkout), with resources in SQLite files in the data directory.
// "Sync" means only this: the whole workspace, .git included, is snapshotted to the data directory once a second and restored on
// the next start. Nothing is pushed to a remote.
//
// A variant supplies infrastructure only (see ./index.mjs): the agent, scenarios and UI are the same for every variant.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { createGitRepository } from '@hachej/boring-files/git';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { createVirtualGitFs, installVirtualGitCommand } from '@hachej/boring-execution/virtual-git';
import { gitRoutes } from './_git-routes.mjs';
import { fictionalHarbourServer } from '../fixtures/mcp-server.mjs';

const ROOT = '/workspace';
const SEED = { [`${ROOT}/README.md`]: '# Fictional workspace\n\nEverything here is invented demo content.\n' };

export default host => ({
  id: 'local', title: 'Local', order: 10,
  description: 'An in-memory just-bash workspace with git, snapshotted to the data directory. Needs nothing but a model key.',
  available: true,
  capabilities: ['workspace', 'shell', 'git', 'python'],
  // The agent may write its own instructions, skills and tools in `.agent/`; its tools run in this virtual just-bash workspace.
  selfEvolving: true,
  // Messages spend fictional credits (examples/studio/server.mjs, CREDITS): an exhausted balance refuses the next message.
  credits: true,
  // One fictional MCP server in this process: its read runs at once, its write asks for approval, its third tool is not allowed.
  mcp: { servers: [{ id: 'harbour', allow: ['tide_times', 'book_mooring'], readOnly: ['tide_times'], transport: () => fictionalHarbourServer().transport }] },
  async open() {
    const { context, directory } = host;
    // Restore the previous snapshot (files, modes, mtimes and empty directories) or start from the seed.
    const snapshotPath = join(directory, 'local-workspace.json');
    const saved = existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, 'utf8')) : null;
    // Every shell of the workspace, the native bash tool's included, gets the git command bound to the repository below, and python3
    // (just-bash's CPython in WebAssembly, Node only; see packages/execution/README.md for its limits).
    let repository;
    const workspace = createVirtualWorkspace({ providerId: 'studio', python: true, onBash: bash => { if (repository) installVirtualGitCommand({ bash, repository }); }, files: saved
      ? Object.fromEntries(Object.entries(saved.files).map(([path, file]) => [path, { content: Uint8Array.from(Buffer.from(file.base64, 'base64')), mode: file.mode, mtime: new Date(file.mtime) }]))
      : SEED });
    const fs = workspace.filesystem;
    for (const path of saved?.directories ?? []) await fs.mkdir(path, { recursive: true });
    const lease = await workspace.acquire({ operationId: 'studio', input: { cwd: ROOT } }, context);
    repository = createGitRepository({ fs: createVirtualGitFs(fs), directory: ROOT, author: { name: 'Fictional Agent', email: 'agent@example.invalid' }, authorize: () => true });
    if (!saved) {
      await repository.init();
      for (const path of Object.keys(SEED)) await repository.add(posix.relative(ROOT, path));
      await repository.commit('Initial commit');
    }

    // Symbolic links are skipped: the library commits them as regular files, so this variant does not claim them.
    async function walk(path, visit) {
      for (const name of (await fs.readdir(path)).sort()) {
        const child = posix.join(path, name), stat = await fs.lstat(child);
        if (stat.isSymbolicLink) continue;
        if (stat.isDirectory) { await visit(child, stat, true); await walk(child, visit); } else await visit(child, stat, false);
      }
    }
    let persisted = '';
    async function persist() {
      const files = {}, directories = [];
      await walk(ROOT, async (path, stat, directory) => {
        if (directory) directories.push(path);
        else files[path] = { base64: Buffer.from(await fs.readFileBuffer(path)).toString('base64'), mode: stat.mode, mtime: stat.mtime.getTime() };
      });
      const text = JSON.stringify({ version: 1, files, directories });
      if (text === persisted) return;
      writeFileSync(`${snapshotPath}.tmp`, text); renameSync(`${snapshotPath}.tmp`, snapshotPath); persisted = text;
    }
    await persist();
    // A snapshot taken in the middle of a git operation can be torn; the next tick and the one in close() replace it.
    const persisting = setInterval(() => { persist().catch(() => {}); }, 1000);

    const env = lease.environment;

    return {
      env, root: ROOT, repository,
      /** Commits seeded files so a scenario starts from a clean tree. */
      async commit(paths, message) { for (const path of paths) await repository.add(path); await repository.commit(message); },
      routes: gitRoutes({ repository, env, root: ROOT, context }),
      persist,
      close: async () => { clearInterval(persisting); await persist(); await lease.release(context); workspace.dispose(); },
    };
  },
});
