import { randomUUID } from '@hachej/boring-files/platform';
import { posix } from 'node:path';
import { Bash, defineCommand } from 'just-bash';
import type { BashOptions, InitialFiles, IFileSystem, InMemoryFs } from 'just-bash';
import type { Context } from '@earendil-works/chord';
import { FileError, ExecutionError, ok, err } from '@earendil-works/pi-durable/env';
import type { ExecutionEnv, FileInfo, FileSystem, Result, TextLineReader } from '@earendil-works/pi-durable/env';
import type { WorkspaceProvider, WorkspaceIdentity } from './contracts.js';
import { FileSystemView, VirtualFileSystem, boundedMessage } from './virtual-filesystem.js';
import type { VirtualFiles } from './virtual-filesystem.js';
export { MAX_ERROR_CHARS } from './virtual-filesystem.js';

export interface VirtualWorkspaceOptions {
  readonly providerId: string;
  readonly files?: InitialFiles;
  readonly storage?: ConstructorParameters<typeof InMemoryFs>[1];
  /**
   * Keep the files in this Pi `FileSystem` (for example `@hachej/boring-files/sqlite-filesystem`) instead of memory: the shell, the native
   * environment and a workspace provider over the same `fs` then see the same files. Not combined with `files` or `storage`.
   */
  readonly fs?: FileSystem;
  readonly bash?: Omit<BashOptions, 'fs' | 'files' | 'cwd' | 'python'>;
  /**
   * Offer `python3` and `python` in the shell: just-bash's CPython compiled to WebAssembly. Off by default. Node only (refused elsewhere,
   * for example in a browser worker); it loads a ~10 MB runtime on first use and its memory is not contained like the shell's limits.
   */
  readonly python?: boolean;
  /** Called with every shell this workspace creates, the native `exec`'s included, for example to install `git` bound to it. */
  readonly onBash?: (bash: Bash) => void;
}

export interface VirtualWorkspace extends WorkspaceProvider<{ readonly cwd: string }, ExecutionEnv> {
  /** Trusted host access. Raw upstream handles remain owned by the host. */
  readonly filesystem: IFileSystem;
  readonly createBash: (options: Omit<BashOptions, 'fs' | 'files' | 'python'>) => Bash;
  readonly dispose: () => void;
}

function fileError(error: unknown, path: string): FileError {
  if (error instanceof FileError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  const message = boundedMessage(cause);
  const code = /\b(ENOENT|ENOTDIR|EISDIR|EACCES|EPERM|EEXIST|EINVAL|ENOTEMPTY)\b/.exec(message)?.[1];
  return new FileError(code === 'ENOENT' ? 'not_found' : code === 'ENOTDIR' ? 'not_directory' : code === 'EISDIR' ? 'is_directory'
    : code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : code === 'EEXIST' || code === 'EINVAL' || code === 'ENOTEMPTY' ? 'invalid' : 'unknown', message, path, cause);
}

/** Working storage: in memory (ephemeral), or the given `fs`. No publication receipts, host fallback or restart recovery. */
export function createVirtualWorkspace(options: VirtualWorkspaceOptions): VirtualWorkspace {
  if (typeof options.providerId !== 'string' || !options.providerId || /[\x00-\x1f]/.test(options.providerId)) throw new TypeError('A provider identifier is required');
  const capture = (content: string | Uint8Array) => typeof content === 'string' ? content : Uint8Array.from(content);
  const files: InitialFiles = Object.fromEntries(Object.entries(options.files ?? {}).map(([path, file]) => [path,
    typeof file === 'function' ? async () => capture(await file()) : typeof file === 'string' || file instanceof Uint8Array ? capture(file)
      : { ...file, content: capture(file.content), ...(file.mtime === undefined ? {} : { mtime: new Date(file.mtime) }) }]));
  if (options.python === true && typeof (globalThis as { process?: { versions?: { node?: unknown } } }).process?.versions?.node !== 'string') {
    throw new TypeError('Python needs Node: just-bash runs CPython only under Node, not in a browser or its workers');
  }
  if (options.fs && (options.files || options.storage)) throw new TypeError('A virtual workspace over a file system takes no initial files or storage');
  const filesystem: VirtualFiles = options.fs ? new FileSystemView(options.fs) : new VirtualFileSystem(files, options.storage);
  const identity: WorkspaceIdentity = Object.freeze({ providerId: options.providerId, instanceId: randomUUID(), incarnation: randomUUID(), viewId: randomUUID() });
  const namespace = `virtual:${identity.instanceId}`;
  let disposed = false;
  const createBash: VirtualWorkspace['createBash'] = input => {
    if (disposed) throw new FileError('invalid', 'Virtual workspace is disposed');
    const limits = options.bash?.executionLimits || input.executionLimits ? { executionLimits: { ...options.bash?.executionLimits, ...input.executionLimits } } : {};
    // Python only when the workspace option says so, whatever a caller's shell options carry.
    const selected = { ...options.bash, ...input, ...limits, fs: filesystem, python: options.python === true };
    const commands = selected.customCommands ?? [];
    const includeLinks = selected.commands === undefined || selected.commands.includes('ln');
    const bash = new Bash({ ...selected, customCommands: includeLinks && !commands.some(command => command.name === 'ln')
      ? [...commands, symbolicLinkCommand] : commands });
    options.onBash?.(bash);
    return bash;
  };
  return {
    providerId: options.providerId, filesystem, createBash,
    dispose: () => { disposed = true; },
    acquire: async (request, context) => {
      if (disposed) throw new FileError('invalid', 'Virtual workspace is disposed');
      if (context.abortSignal?.aborted) throw new FileError('aborted', 'Workspace acquisition aborted');
      const cwd = request.input.cwd;
      if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('\0')) throw new FileError('invalid', 'An absolute virtual cwd is required');
      if (!(await filesystem.stat(cwd)).isDirectory) throw new FileError('not_directory', 'Working directory is not a directory', cwd);
      if (disposed || context.abortSignal?.aborted) throw new FileError(disposed ? 'invalid' : 'aborted', 'Workspace acquisition is no longer available');
      let released = false;
      const environment = nativeEnvironment(filesystem, namespace, cwd, () => disposed || released, async () => { released = true; }, createBash);
      return { identity, environment, ownership: 'borrowed', release: environment.cleanup };
    },
  };
}

// Stock ln -f removes the destination before calling fs.link, which this backing cannot support.
const symbolicLinkCommand = defineCommand('ln', async (input, context) => {
  // Stock ln lacks -T/--no-target-directory. Strip it here and refuse a directory destination as native ln does.
  const args: string[] = [];
  let symbolic = false, plain = false, flags = true;
  for (const arg of input) {
    if (flags && (arg === '--' || !arg.startsWith('-'))) flags = false;
    if (flags && arg === '--no-target-directory') { plain = true; continue; }
    if (flags && arg.includes('T') && /^-[sfvnT]+$/.test(arg)) {
      plain = true;
      if (arg.replaceAll('T', '') === '-') continue;
      args.push(arg.replaceAll('T', '')); if (/^-[sfvn]*s/.test(arg)) symbolic = true; continue;
    }
    if (flags && (arg === '--symbolic' || /^-[sfvn]*s[sfvn]*$/.test(arg))) symbolic = true;
    args.push(arg);
  }
  if (!symbolic && !(args.length === 1 && args[0] === '--help')) {
    return { stdout: '', stderr: 'ln: ENOTSUP: hard links are not supported by this backing\n', exitCode: 1 };
  }
  if (!context.origCommand) return { stdout: '', stderr: 'ln: stock command is unavailable\n', exitCode: 126 };
  const destination = args.at(-1);
  if (plain && destination && !destination.startsWith('-') && await context.fs.stat(context.fs.resolvePath(context.cwd, destination)).then(stat => stat.isDirectory, () => false)) {
    return { stdout: '', stderr: `ln: cannot overwrite directory '${destination}'\n`, exitCode: 1 };
  }
  return context.origCommand(args);
});

function nativeEnvironment(fs: VirtualFiles, id: string, cwd: string, closed: () => boolean, release: ExecutionEnv['cleanup'], createBash: VirtualWorkspace['createBash']): ExecutionEnv {
  const failure = (context: Context, path?: string) => closed() ? new FileError('invalid', 'Workspace lease is closed', path)
    : context.abortSignal?.aborted ? new FileError('aborted', 'Operation aborted', path) : undefined;
  const absolute = (path: string) => {
    if (typeof path !== 'string' || path.includes('\0') || typeof environment.cwd !== 'string' || !environment.cwd.startsWith('/')) throw new FileError('invalid', 'Invalid virtual path', path);
    return posix.resolve(environment.cwd, path);
  };
  async function run<Value>(path: string, context: Context, operation: (resolved: string) => Value | Promise<Value>): Promise<Result<Value, FileError>> {
    try {
      const before = failure(context, path); if (before) return err(before);
      const value = await operation(absolute(path));
      const after = failure(context, path); return after ? err(after) : ok(value);
    } catch (error) { return err(fileError(error, path)); }
  }
  const info = async (path: string): Promise<FileInfo> => {
    const stat = await fs.lstat(path);
    return { path, name: posix.basename(path), kind: stat.isSymbolicLink ? 'symlink' : stat.isDirectory ? 'directory' : 'file', size: stat.size, mtimeMs: stat.mtime.getTime() };
  };
  async function temporary(prefix: string, suffix: string, directory: boolean): Promise<string> {
    if (prefix.includes('/') || suffix.includes('/') || prefix.includes('\0') || suffix.includes('\0')) throw new FileError('invalid', 'Temporary names must be basenames');
    await fs.mkdir('/tmp', { recursive: true });
    const path = `/tmp/${prefix}${randomUUID()}${suffix}`;
    await fs.createExclusive(path, { mode: directory ? 0o700 : 0o600, directory });
    return path;
  }
  const environment: ExecutionEnv = {
    id, cwd: posix.normalize(cwd),
    absolutePath: (path, context) => run(path, context, path => path),
    joinPath: (parts, context) => run('.', context, () => posix.join(...parts)),
    readTextFile: (path, context) => run(path, context, path => fs.readFile(path)),
    readBinaryFile: (path, context) => run(path, context, async path => Uint8Array.from(await fs.readFileBuffer(path))),
    writeFile: (path, content, context) => run(path, context, path => fs.writeFile(path, typeof content === 'string' ? content : Uint8Array.from(content))),
    appendFile: (path, content, context) => run(path, context, path => fs.appendFile(path, typeof content === 'string' ? content : Uint8Array.from(content))),
    truncateFile: (path, size, context) => run(path, context, path => {
      if (!Number.isSafeInteger(size) || size < 0) throw new FileError('invalid', 'File size must be a non-negative safe integer', path);
      throw new FileError('not_supported', 'The selected backing has no atomic truncate operation', path);
    }),
    flushFile: (path, context) => run(path, context, () => { throw new FileError('not_supported', 'Memory storage cannot flush to durable backing', path); }),
    // Qualified for one regular file onto a file or a missing path only; anything else keeps refusing before effects.
    renameFile: (source, destination, context) => run(source, context, async from => {
      const to = absolute(destination);
      try { await fs.replaceFile(from, to); }
      catch (error) {
        if (error instanceof Error && /\b(ENOTSUP|EISDIR)\b/.test(error.message)) throw new FileError('not_supported', 'The selected backing renames a regular file onto a file or a missing path only', from);
        throw error;
      }
    }),
    fileInfo: (path, context) => run(path, context, info),
    listDir: (path, context) => run(path, context, async path => Promise.all((await fs.readdir(path)).map(name => info(posix.join(path, name))))),
    canonicalPath: (path, context) => run(path, context, path => fs.realpath(path)),
    exists: (path, context) => run(path, context, async path => {
      try { await fs.lstat(path); return true; }
      catch (error) { if (fileError(error, path).code === 'not_found') return false; throw error; }
    }),
    createDir: (path, options, context) => run(path, context, path => fs.mkdir(path, { ...options, recursive: options?.recursive ?? true })),
    remove: (path, options, context) => run(path, context, path => fs.rm(path, options)),
    createTempDir: (prefix, context) => run('.', context, () => temporary(prefix ?? 'boring-', '', true)),
    createTempFile: (options, context) => run('.', context, () => temporary(options?.prefix ?? 'boring-', options?.suffix ?? '', false)),
    openTextLineReader: (path, context) => run(path, context, async path => {
      const text = await fs.readFile(path);
      let offset = 0, readerClosed = false;
      const reader: TextLineReader = {
        readLine: async context => {
          const invalid = failure(context, path); if (invalid) return err(invalid);
          if (readerClosed) return err(new FileError('invalid', 'Text line reader is closed', path));
          if (offset === text.length) return ok(undefined);
          const newline = text.indexOf('\n', offset);
          const line = { text: text.slice(offset, newline === -1 ? undefined : newline), terminated: newline !== -1 };
          offset = newline === -1 ? text.length : newline + 1;
          return ok(line);
        },
        close: async () => { readerClosed = true; },
      };
      return reader;
    }),
    readTextLines: async (path, options, context) => {
      if (options?.maxLines !== undefined && options.maxLines <= 0) return ok([]);
      const opened = await environment.openTextLineReader(path, context); if (!opened.ok) return opened;
      const lines: string[] = [];
      try {
        while (options?.maxLines === undefined || lines.length < options.maxLines) {
          const line = await opened.value.readLine(context); if (!line.ok) return line;
          if (line.value === undefined) break;
          lines.push(line.value.text);
        }
        return ok(lines);
      } finally { await opened.value.close(context); }
    },
    exec: async (command, options, context) => {
      if (closed()) return err(new ExecutionError('shell_unavailable', 'Workspace lease is closed'));
      if (context.abortSignal?.aborted) return err(new ExecutionError('aborted', 'Command aborted'));
      // just-bash buffers output: `onOutput` receives it once when the command ends, never as a live stream, and
      // nothing is spilled to a file. This is what lets Pi's stock bash tool run here. `timeout` is in seconds.
      const timer = new AbortController(), signals = [timer.signal, ...(context.abortSignal ? [context.abortSignal] : [])];
      const started = Date.now();
      const timeout = options?.timeout === undefined ? undefined : setTimeout(() => timer.abort(), options.timeout * 1000);
      try {
        const cwd = absolute(options?.cwd ?? '.');
        try { if (!(await fs.stat(cwd)).isDirectory) throw new Error('not a directory'); }
        catch (cause) { return err(new ExecutionError('spawn_error', `Working directory does not exist: ${cwd}\nCannot execute bash commands.`, cause instanceof Error ? cause : undefined)); }
        const result = await createBash({ cwd, ...(options?.timeout === undefined ? {} : { executionLimits: { maxExecutionTimeMs: options.timeout * 1000 } }) }).exec(command, {
          ...(options?.env === undefined ? {} : { env: options.env }), replaceEnv: options?.inheritEnv === false,
          signal: AbortSignal.any(signals),
        });
        if (context.abortSignal?.aborted) return err(new ExecutionError('aborted', 'Command aborted; prior effects may remain'));
        // A synchronous script never yields to the timer above; just-bash's own wall-clock limit stops it instead.
        if (timer.signal.aborted || options?.timeout !== undefined && result.exitCode !== 0 && Date.now() - started >= options.timeout * 1000) return err(new ExecutionError('timeout', 'Command timed out; prior effects may remain'));
        if (options?.onOutput) {
          const output = `${result.stdout}${result.stderr}`;
          if (output) { try { options.onOutput(output, context); } catch (error) { return err(new ExecutionError('callback_error', boundedMessage(error), error instanceof Error ? error : undefined)); } }
        }
        return ok({ exitCode: result.exitCode });
      } catch (error) { return err(new ExecutionError('unknown', boundedMessage(error), error instanceof Error ? error : undefined)); }
      finally { clearTimeout(timeout); }
    },
    cleanup: release,
  };
  return environment;
}
