// One git repository in a virtual workspace (a browser tab, or Node): a just-bash workspace with isomorphic-git whose files live in
// SQLite, through the Pi `FileSystem` of `@hachej/boring-files/sqlite-filesystem` (in a browser over `openBrowserSqliteConnection`). Every
// write lands in SQLite as it happens: there is no copy in memory and nothing to save. Pi's native tools reach it through a native
// `ExecutionEnv` whose bash also has the `git` command bound to the same repository. Nothing here is a second file or shell API:
// `env` is Pi's and `repository` is `@hachej/boring-files/git`'s.
import { posix } from 'node:path';
import type { Context } from '@earendil-works/chord';
import type { ExecutionEnv, FileSystem } from '@earendil-works/pi-durable/env';
import { createGitRepository } from '@hachej/boring-files/git';
import type { GitOperation } from '@hachej/boring-files/git';
import { createVirtualWorkspace } from './virtual.js';
import { createVirtualGitFs, installVirtualGitCommand } from './virtual-git.js';

export interface VirtualRepositoryOptions {
  /** Where the files live, for example `openSqliteFileSystem({ connection, workspace, cwd: root })` from `@hachej/boring-files/sqlite-filesystem`. */
  readonly fs: FileSystem;
  /** Absolute directory of the repository inside the file system. Default `/repo`. */
  readonly root?: string;
  /** Files of a new repository, by path relative to `root`. They are committed as `seedMessage`; ignored when the repository exists. */
  readonly seed?: Readonly<Record<string, string>>;
  readonly seedMessage?: string;
  /** Commit author for `repository.commit` (the shell's `git commit` too). */
  readonly author?: { readonly name: string; readonly email: string };
  /** Context for acquiring the workspace (a host context such as `BACKGROUND_CONTEXT`). */
  readonly context: Context;
  /** The host's git policy for `repository` (and the shell's `git`). Default: every operation is allowed. */
  readonly authorize?: (operation: GitOperation) => boolean | Promise<boolean>;
  /** Provider id recorded in the workspace identity. Default `virtual-sqlite`. */
  readonly providerId?: string;
}

type Repository = ReturnType<typeof createGitRepository<ReturnType<typeof createVirtualGitFs>>>;

/**
 * One repository, one working view: Pi's native `env` for reading, listing, writing and running commands (its bash has
 * `git`), and the `@hachej/boring-files/git` service bound to the same files. There is deliberately no second file or shell API.
 */
export interface VirtualRepository {
  readonly root: string;
  /** Pi's native `ExecutionEnv` over the repository: native tools use it; its `exec` shell has the `git` command. */
  readonly env: ExecutionEnv;
  readonly repository: Repository;
  /** Release the workspace. The files stay where `fs` keeps them. */
  close(): Promise<void>;
}

/** Open the repository in `fs`, or create it from `seed` when `root` has no `.git` yet. */
export async function openVirtualRepository(options: VirtualRepositoryOptions): Promise<VirtualRepository> {
  const { context } = options;
  const root = posix.normalize(options.root ?? '/repo').replace(/(.)\/$/, '$1');
  if (!root.startsWith('/') || root === '/') throw new TypeError('root must be an absolute directory such as /repo');

  // Every shell of the workspace, the native `exec`'s included, gets `git` bound to the one repository on the same files.
  let repository: Repository | undefined;
  const workspace = createVirtualWorkspace({ providerId: options.providerId ?? 'virtual-sqlite', fs: options.fs,
    onBash: bash => { if (repository) installVirtualGitCommand({ bash, repository }); } });
  const filesystem = workspace.filesystem;
  await filesystem.mkdir(root, { recursive: true });
  const fresh = !await filesystem.exists(posix.join(root, '.git'));
  if (fresh) {
    for (const [path, text] of Object.entries(options.seed ?? {})) {
      const absolute = posix.join(root, path);
      await filesystem.mkdir(posix.dirname(absolute), { recursive: true });
      await filesystem.writeFile(absolute, text);
    }
  }
  const lease = await workspace.acquire({ operationId: 'virtual-sqlite', input: { cwd: root } }, context);
  repository = createGitRepository({ fs: createVirtualGitFs(filesystem), directory: root, authorize: options.authorize ?? (() => true),
    author: options.author ?? { name: 'Agent', email: 'agent@example.invalid' } });
  if (fresh) {
    await repository.init();
    for (const path of Object.keys(options.seed ?? {})) await repository.add(path);
    if (Object.keys(options.seed ?? {}).length) await repository.commit(options.seedMessage ?? 'Initial commit');
  }

  return {
    root, env: lease.environment, repository,
    async close() { try { await lease.release(context); } finally { workspace.dispose(); } },
  };
}
