import git from 'isomorphic-git';
import type { PromiseFsClient, WalkerEntry } from 'isomorphic-git';
import { posix } from 'node:path';
import type { Context } from '@earendil-works/chord';
import type { FileError, FileInfo, FileSystem, Result } from '@earendil-works/pi-durable/env';

export type GitOperation = 'init' | 'status' | 'add' | 'remove' | 'commit' | 'log' | 'branches' | 'branch' | 'checkout' | 'diff';
export type GitView = { readonly kind: 'tree'; readonly ref: string } | { readonly kind: 'index' } | { readonly kind: 'worktree' };
export interface GitFileVersion {
  readonly oid: string;
  readonly mode: number;
  readonly bytes: Uint8Array;
}
export interface GitFileChange {
  readonly path: string;
  readonly before: GitFileVersion | null;
  readonly after: GitFileVersion | null;
}
export interface GitRepositoryOptions<FS extends PromiseFsClient> {
  readonly fs: FS;
  readonly directory: string;
  readonly author: NonNullable<Parameters<typeof git.commit>[0]['author']>;
  /** A current repository-wide grant for the host-bound caller, including all worktree and Git metadata. */
  readonly authorize: (operation: GitOperation) => boolean | Promise<boolean>;
  /** Returned diff limits. Upstream may allocate an entire blob before its size is checked. */
  readonly diffLimits?: { readonly files: number; readonly bytes: number };
}
export class GitOperationError extends Error {
  constructor(message: string, readonly effects: 'none' | 'possible', options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitOperationError';
  }
}

function name(value: string, label: string): string {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw new TypeError(`Invalid Git ${label}`);
  return value;
}
/** check-ref-format rules, so a name can never resolve outside refs/ or the repository. */
function refname(value: string): string {
  name(value, 'reference');
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.endsWith('.') || value === '@' || value.includes('//')
    || value.includes('..') || value.includes('@{') || /[ ~^:?*[\\]/.test(value)
    || value.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) throw new TypeError('Invalid Git reference');
  return value;
}
function filepath(value: string): string {
  name(value, 'path');
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some(part => part === '..' || part.toLowerCase() === '.git')) throw new TypeError('Git paths must stay in the selected worktree');
  return value;
}

/** Borrow one filesystem and share this instance across callers. Raw filesystem writers do not take this queue. */
export function createGitRepository<FS extends PromiseFsClient>(options: GitRepositoryOptions<FS>) {
  const { fs, authorize } = options;
  const directory = name(options.directory, 'directory');
  if (!directory.startsWith('/') || posix.normalize(directory) !== directory) throw new TypeError('Git directory must be an absolute normalized path');
  const author = { ...options.author };
  const repo = { fs, dir: directory };
  const limits = { files: 100, bytes: 1024 * 1024, ...options.diffLimits };
  if (![limits.files, limits.bytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new TypeError('Git diff limits must be positive safe integers');
  let pending: Promise<void> = Promise.resolve();
  function run<Value>(operation: GitOperation, mutation: boolean, signal: AbortSignal | undefined, execute: () => Promise<Value>): Promise<Value> {
    const result = pending.then(async () => {
      let started = false;
      try {
        if (signal?.aborted) throw new Error('Git operation aborted before execution');
        if (await authorize(operation) !== true) throw new Error('Git repository authorization denied');
        if (signal?.aborted) throw new Error('Git operation aborted before execution');
        started = true;
        const value = await execute();
        if (signal?.aborted) throw new Error('Git operation aborted after execution');
        if (await authorize(operation) !== true) throw new Error('Git repository authorization changed during execution');
        if (signal?.aborted) throw new Error('Git operation aborted after execution');
        return value;
      } catch (cause) {
        const effects = started && mutation ? 'possible' : 'none';
        throw new GitOperationError(`${cause instanceof Error ? cause.message : String(cause)}${effects === 'possible' ? '; prior Git effects may remain' : ''}`, effects, { cause });
      }
    });
    pending = result.then(() => undefined, () => undefined);
    return result;
  }
  function tree(view: GitView) {
    switch (view.kind) {
      case 'tree': return git.TREE({ ref: refname(view.ref) });
      case 'index': return git.STAGE();
      case 'worktree': return git.WORKDIR({ refresh: false });
    }
  }
  return Object.freeze({
    fs, directory,
    init: (signal?: AbortSignal) => run('init', true, signal, () => git.init({ ...repo, defaultBranch: 'main' })),
    status: (signal?: AbortSignal) => run('status', false, signal, () => git.statusMatrix({ ...repo, refresh: false })),
    add: (path: string, signal?: AbortSignal) => {
      const selected = filepath(path);
      return run('add', true, signal, () => git.add({ ...repo, filepath: selected }));
    },
    remove: (path: string, signal?: AbortSignal) => {
      const selected = filepath(path);
      return run('remove', true, signal, () => git.remove({ ...repo, filepath: selected }));
    },
    commit: (message: string, signal?: AbortSignal) => {
      if (typeof message !== 'string' || !message.trim() || message.includes('\0')) throw new TypeError('Invalid Git message');
      const selected = message;
      return run('commit', true, signal, () => git.commit({ ...repo, author, message: selected }));
    },
    log: (signal?: AbortSignal) => run('log', false, signal, () => git.log({ ...repo, depth: 20 })),
    branches: (signal?: AbortSignal) => run('branches', false, signal, () => git.listBranches(repo)),
    branch: (ref: string, signal?: AbortSignal) => {
      const selected = refname(ref);
      return run('branch', true, signal, () => git.branch({ ...repo, ref: selected }));
    },
    checkout: (ref: string, signal?: AbortSignal) => {
      const selected = refname(ref);
      return run('checkout', true, signal, () => git.checkout({ ...repo, ref: selected }));
    },
    diff: (before: GitView, after: GitView, signal?: AbortSignal) => {
      const trees = [tree(before), tree(after)];
      return run('diff', false, signal, async () => {
        const changes: GitFileChange[] = [];
        let bytes = 0;
        async function version(entry: WalkerEntry | null): Promise<GitFileVersion | null> {
          if (!entry) return null;
          if (await entry.type() !== 'blob') throw new Error('Git diff supports blob entries only');
          const oid = await entry.oid();
          const content = await entry.content() ?? (await git.readBlob({ ...repo, oid })).blob;
          const copied = Uint8Array.from(content);
          bytes += copied.length;
          if (bytes > limits.bytes) throw new Error('Git diff byte limit exceeded');
          return { oid, mode: await entry.mode(), bytes: copied };
        }
        await git.walk({ ...repo, trees, iterate: async (walk, children) => {
          for (const child of children) await walk(child);
          return [];
        }, map: async (path, entries) => {
          if (path === '.git') return null;
          if (signal?.aborted) throw new Error('Git diff aborted');
          let left = entries[0] ?? null, right = entries[1] ?? null;
          if (left && await left.type() === 'tree') left = null;
          if (right && await right.type() === 'tree') right = null;
          if (!left && !right) return;
          if (left && right && await left.oid() === await right.oid() && await left.mode() === await right.mode()) return;
          if (changes.length >= limits.files) throw new Error('Git diff file limit exceeded');
          const change = { path, before: await version(left), after: await version(right) };
          changes.push(change);
        } });
        return changes.sort((left, right) => left.path.localeCompare(right.path));
      });
    },
  });
}

export type GitRepository = ReturnType<typeof createGitRepository>;

const ERRNO: Readonly<Record<string, string>> = { not_found: 'ENOENT', not_directory: 'ENOTDIR', is_directory: 'EISDIR', permission_denied: 'EACCES', not_supported: 'ENOSYS', aborted: 'EINTR' };
const failure = (message: string, code: string, cause?: unknown): Error => Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });

/**
 * isomorphic-git I/O over a Pi `FileSystem` (an `ExecutionEnv`'s files): every read and write goes through that environment, so its
 * confinement (for example the AWS adapter's folder and symbolic link checks) also confines Git. No second checkout, no native Git.
 * Modes are not part of Pi's file contract: files read as 0o100644. Symbolic links are refused (`ENOSYS`): Git fails on a worktree
 * that contains one rather than following it.
 */
export function createEnvGitFs(filesystem: FileSystem, context: Context) {
  const value = <T>(result: Result<T, FileError>): T => {
    if (result.ok) return result.value;
    throw failure(result.error.message, ERRNO[result.error.code] ?? 'EIO', result.error);
  };
  const unsupported = (what: string): never => { throw failure(`${what}: symbolic links are not supported on this workspace`, 'ENOSYS'); };
  // Racy-clean guard, as in the virtual Git fs: isomorphic-git compares whole seconds, so a same-size edit in the second of its `add`
  // looks clean. The reported inode folds in the millisecond mtime, and is unique per call while the file is fresh.
  let fresh = 0;
  const stat = (info: FileInfo) => {
    const racy = Date.now() - info.mtimeMs < 1000;
    return {
      type: info.kind === 'directory' ? 'dir' : info.kind, mode: info.kind === 'directory' ? 0o40000 : info.kind === 'symlink' ? 0o120000 : 0o100644,
      size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.mtimeMs, uid: 0, gid: 0, dev: 0,
      ino: racy ? 0x80000000 + (++fresh % 0x7fffffff) : Math.floor(info.mtimeMs) % 0x80000000,
      isFile: () => info.kind === 'file', isDirectory: () => info.kind === 'directory', isSymbolicLink: () => info.kind === 'symlink',
    };
  };
  return { promises: {
    readFile: async (path: string, options?: string | { encoding?: string }) => {
      const bytes = value(await filesystem.readBinaryFile(path, context));
      return (typeof options === 'string' ? options : options?.encoding) ? new TextDecoder().decode(bytes) : bytes;
    },
    writeFile: async (path: string, bytes: string | Uint8Array) => { value(await filesystem.writeFile(path, typeof bytes === 'string' ? bytes : Uint8Array.from(bytes), context)); },
    unlink: async (path: string) => {
      if (value(await filesystem.fileInfo(path, context)).kind === 'directory') throw failure(`EISDIR: ${path}`, 'EISDIR');
      value(await filesystem.remove(path, { recursive: false }, context));
    },
    readdir: async (path: string) => value(await filesystem.listDir(path, context)).map(entry => entry.name),
    mkdir: async (path: string) => { value(await filesystem.createDir(path, { recursive: true }, context)); },
    rmdir: async (path: string) => {
      if (value(await filesystem.fileInfo(path, context)).kind !== 'directory') throw failure(`ENOTDIR: ${path}`, 'ENOTDIR');
      if (value(await filesystem.listDir(path, context)).length) throw failure(`ENOTEMPTY: ${path}`, 'ENOTEMPTY');
      value(await filesystem.remove(path, { recursive: true }, context));
    },
    stat: async (path: string) => stat(value(await filesystem.fileInfo(value(await filesystem.canonicalPath(path, context)), context))),
    lstat: async (path: string) => stat(value(await filesystem.fileInfo(path, context))),
    readlink: async (path: string) => unsupported(`readlink ${path}`),
    symlink: async (_target: string, path: string) => unsupported(`symlink ${path}`),
    chmod: async () => {},
  } } satisfies PromiseFsClient;
}
