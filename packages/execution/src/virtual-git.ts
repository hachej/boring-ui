import type { Bash, IFileSystem, FsStat, BufferEncoding } from 'just-bash';
import { defineCommand } from 'just-bash';
import type { createGitRepository } from '@hachej/boring-files/git';
import type { PromiseFsClient } from 'isomorphic-git';
import { posix } from 'node:path';
import { boundedMessage, mutationPath } from './virtual-filesystem.js';

/** isomorphic-git I/O over the selected just-bash view; no second checkout or native Git. */
export function createVirtualGitFs(filesystem: IFileSystem) {
  const wrap = <Args extends unknown[], Value>(operation: (...args: Args) => Promise<Value>) => async (...args: Args): Promise<Value> => {
    try { return await operation(...args); }
    catch (error) {
      if (error instanceof Error) {
        const code = /\b(ENOENT|EEXIST|ENOTDIR|EISDIR|ENOTEMPTY|EACCES|EPERM|EINVAL)\b/.exec(error.message)?.[1];
        if (code) throw Object.assign(new Error(error.message, { cause: error }), { code });
      }
      throw error;
    }
  };
  // Racy-clean guard: isomorphic-git compares whole seconds, so a same-size edit in the second of its `add` looks clean. The
  // reported inode folds in the millisecond mtime, and is unique per call while the file is fresh, so such entries are rehashed.
  let fresh = 0;
  const stat = (value: FsStat) => {
    const mtimeMs = value.mtime.getTime(), racy = Date.now() - mtimeMs < 1000;
    return {
      ...value, isFile: () => value.isFile, isDirectory: () => value.isDirectory, isSymbolicLink: () => value.isSymbolicLink,
      mode: value.isSymbolicLink ? 0o120000 | (value.mode & 0o777) : value.mode,
      mtimeMs, ctime: value.mtime, ctimeMs: mtimeMs, uid: 0, gid: 0, dev: value.dev ?? 0,
      ino: racy ? 0x80000000 + (++fresh % 0x7fffffff) : (Number(value.ino ?? 0) * 31 + mtimeMs) % 0x80000000,
    };
  };
  return { filesystem, promises: {
    readFile: wrap(async (path: string, options?: BufferEncoding | { encoding?: BufferEncoding }) => {
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? filesystem.readFile(path, encoding) : Uint8Array.from(await filesystem.readFileBuffer(path));
    }),
    writeFile: wrap(async (path: string, bytes: string | Uint8Array) => {
      const captured = typeof bytes === 'string' ? bytes : Uint8Array.from(bytes);
      await filesystem.writeFile(await mutationPath(filesystem, path, false, true), captured);
    }),
    unlink: wrap(async (path: string) => {
      path = posix.join(await filesystem.realpath(posix.dirname(path)), posix.basename(path));
      if ((await filesystem.lstat(path)).isDirectory) throw new Error('EISDIR: unlink requires a file');
      await filesystem.rm(path);
    }),
    readdir: wrap((path: string) => filesystem.readdir(path)),
    mkdir: wrap(async (path: string, options?: { recursive?: boolean } | number) => {
      const selected = typeof options === 'object' ? options : {};
      await filesystem.mkdir(await mutationPath(filesystem, path, selected.recursive === true, false), selected);
    }),
    rmdir: wrap(async (path: string) => {
      path = posix.join(await filesystem.realpath(posix.dirname(path)), posix.basename(path));
      if (!(await filesystem.lstat(path)).isDirectory) throw new Error('ENOTDIR: rmdir requires a directory');
      await filesystem.rm(path);
    }),
    stat: wrap(async (path: string) => stat(await filesystem.stat(path))),
    lstat: wrap(async (path: string) => stat(await filesystem.lstat(path))),
    readlink: wrap((path: string) => filesystem.readlink(path)),
    symlink: wrap((target: string, path: string) => filesystem.symlink(target, path)),
    chmod: wrap((path: string, mode: number) => filesystem.chmod(path, mode)),
  } } satisfies PromiseFsClient & { filesystem: IFileSystem };
}

export interface VirtualGitOptions {
  readonly bash: Bash;
  readonly repository: ReturnType<typeof createGitRepository<ReturnType<typeof createVirtualGitFs>>>;
}

/** Bind one repository service to its selected backing and root cwd. */
export function installVirtualGitCommand({ bash, repository }: VirtualGitOptions): void {
  if (bash.fs !== repository.fs.filesystem) throw new TypeError('Git command requires its bound filesystem');
  bash.registerCommand(defineCommand('git', async (args, context) => {
    if (context.cwd !== repository.directory) {
      return { stdout: '', stderr: 'Git command requires its bound filesystem and repository cwd\n', exitCode: 126 };
    }
    const [command, ...rest] = args;
    const signal = context.signal;
    let stdout = '';
    try {
      if (command === 'init' && rest.length === 0) {
        await repository.init(signal); stdout = 'Initialized virtual Git repository\n';
      } else if (command === 'status' && rest.length === 0) {
        stdout = JSON.stringify(await repository.status(signal)) + '\n';
      } else if (command === 'add' && rest.length === 1 && rest[0] && !rest[0].startsWith('-')) {
        await repository.add(rest[0], signal);
      } else if (command === 'rm' && rest.length === 2 && rest[0] === '--cached' && rest[1]) {
        await repository.remove(rest[1], signal);
      } else if (command === 'commit' && rest.length === 2 && rest[0] === '-m' && rest[1]) {
        stdout = await repository.commit(rest[1], signal) + '\n';
      } else if (command === 'log' && rest.length === 0) {
        stdout = JSON.stringify(await repository.log(signal)) + '\n';
      } else if (command === 'branch' && rest.length === 0) {
        stdout = (await repository.branches(signal)).join('\n') + '\n';
      } else if (command === 'branch' && rest.length === 1 && rest[0] && !rest[0].startsWith('-')) {
        await repository.branch(rest[0], signal);
      } else if (command === 'checkout' && rest.length === 1 && rest[0] && !rest[0].startsWith('-')) {
        await repository.checkout(rest[0], signal);
      } else if (command === 'diff' && (rest.length === 0 || rest.length === 1 && rest[0] === '--cached')) {
        stdout = JSON.stringify(await repository.diff(rest.length ? { kind: 'tree', ref: 'HEAD' } : { kind: 'index' }, rest.length ? { kind: 'index' } : { kind: 'worktree' }, signal)) + '\n';
      } else {
        return { stdout: '', stderr: 'Unsupported virtual Git command or arguments\n', exitCode: 126 };
      }
      return { stdout, stderr: '', exitCode: 0 };
    } catch (error) {
      return { stdout, stderr: `${boundedMessage(error)}\n`, exitCode: 1 };
    }
  }));
}
