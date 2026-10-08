import { posix } from 'node:path';
import { InMemoryFs } from 'just-bash';
import type { IFileSystem, FileContent, MkdirOptions, RmOptions, CpOptions, BufferEncoding, FsStat, CreateExclusiveOptions } from 'just-bash';

type ReadFileOptions = Exclude<Parameters<IFileSystem['readFile']>[1], string | undefined>;
type WriteFileOptions = Exclude<Parameters<IFileSystem['writeFile']>[2], string | undefined>;
type DirentEntry = Awaited<ReturnType<NonNullable<IFileSystem['readdirWithFileTypes']>>>[number];
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { FileError, FileSystem, Result } from '@earendil-works/pi-durable/env';
import { boundedMessage } from './bounded-error.js';
export { MAX_ERROR_CHARS, boundedMessage } from './bounded-error.js';

/** What the shell and the native environment need from the files under them: just-bash's interface plus an atomic file replace. */
export type VirtualFiles = IFileSystem & {
  readonly replaceFile: (source: string, destination: string) => Promise<void>;
  readonly createExclusive: (path: string, options: CreateExclusiveOptions) => Promise<void>;
};

const errno: Record<FileError['code'], string> = {
  not_found: 'ENOENT', not_directory: 'ENOTDIR', is_directory: 'EISDIR', permission_denied: 'EACCES', invalid: 'EINVAL', not_supported: 'ENOTSUP', aborted: 'ECANCELED', unknown: 'EIO',
};
async function value<Value>(pending: Promise<Result<Value, FileError>>): Promise<Value> {
  const result = await pending;
  if (result.ok) return result.value;
  // Shells and Git read the POSIX code from the start of the message.
  const message = boundedMessage(result.error);
  throw new Error(/^E[A-Z]+\b/.test(message) ? message : `${errno[result.error.code]}: ${message}`, { cause: result.error });
}
const encodingOf = (options?: ReadFileOptions | WriteFileOptions | BufferEncoding | null) => (typeof options === 'string' ? options : options?.encoding) ?? 'utf8';
const latin1 = (bytes: Uint8Array) => Array.from(bytes, byte => String.fromCharCode(byte)).join('');
function decode(bytes: Uint8Array, encoding: BufferEncoding | null): string {
  if (encoding === 'utf8' || encoding === 'utf-8' || encoding === null) return new TextDecoder().decode(bytes);
  if (encoding === 'base64') return btoa(latin1(bytes));
  if (encoding === 'hex') return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return encoding === 'ascii' ? latin1(bytes.map(byte => byte & 0x7f)) : latin1(bytes);
}
function encode(content: FileContent, encoding: BufferEncoding): Uint8Array {
  if (typeof content !== 'string') return Uint8Array.from(content);
  if (encoding === 'utf8' || encoding === 'utf-8') return new TextEncoder().encode(content);
  if (encoding === 'base64') return Uint8Array.from(atob(content), char => char.charCodeAt(0));
  if (encoding === 'hex') return Uint8Array.from(content.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
  return Uint8Array.from(content, char => char.charCodeAt(0) & 0xff);
}

/**
 * just-bash's file interface over a Pi `FileSystem` (for example `@hachej/boring-files/sqlite-filesystem`), so the shell, Git and the native
 * environment work on the very files the workspace provider reads and writes: one view, no copy. That file system has regular files
 * and directories only: links are refused, `chmod` changes nothing (files report 0644, directories 0755) and `utimes` sets the
 * modification time to now.
 */
export class FileSystemView implements VirtualFiles {
  constructor(private readonly fs: FileSystem) {}
  private stats = async (path: string): Promise<FsStat> => {
    const info = await value(this.fs.fileInfo(path, BACKGROUND_CONTEXT));
    const directory = info.kind === 'directory';
    return { isFile: !directory, isDirectory: directory, isSymbolicLink: false, mode: directory ? 0o755 : 0o644, size: info.size, mtime: new Date(info.mtimeMs) };
  };
  async readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string> { return decode(await this.readFileBuffer(path), encodingOf(options)); }
  readFileBuffer(path: string): Promise<Uint8Array> { return value(this.fs.readBinaryFile(path, BACKGROUND_CONTEXT)); }
  writeFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> { return value(this.fs.writeFile(path, encode(content, encodingOf(options) ?? 'utf8'), BACKGROUND_CONTEXT)); }
  appendFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> { return value(this.fs.appendFile(path, encode(content, encodingOf(options) ?? 'utf8'), BACKGROUND_CONTEXT)); }
  exists(path: string): Promise<boolean> { return value(this.fs.exists(path, BACKGROUND_CONTEXT)); }
  stat(path: string): Promise<FsStat> { return this.stats(path); }
  lstat(path: string): Promise<FsStat> { return this.stats(path); }
  mkdir(path: string, options?: MkdirOptions): Promise<void> { return value(this.fs.createDir(path, { recursive: options?.recursive === true }, BACKGROUND_CONTEXT)); }
  async readdir(path: string): Promise<string[]> { return (await value(this.fs.listDir(path, BACKGROUND_CONTEXT))).map(entry => entry.name).sort(); }
  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    return (await value(this.fs.listDir(path, BACKGROUND_CONTEXT))).sort((a, b) => a.name < b.name ? -1 : 1)
      .map(entry => ({ name: entry.name, isFile: entry.kind === 'file', isDirectory: entry.kind === 'directory', isSymbolicLink: entry.kind === 'symlink' }));
  }
  rm(path: string, options?: RmOptions): Promise<void> { return value(this.fs.remove(path, { recursive: options?.recursive === true, force: options?.force === true }, BACKGROUND_CONTEXT)); }
  async cp(source: string, destination: string, options?: CpOptions): Promise<void> {
    if (!(await this.stats(source)).isDirectory) return this.writeFile(destination, await this.readFileBuffer(source));
    if (!options?.recursive) throw new Error(`EISDIR: copying a directory needs recursive, '${source}'`);
    await this.mkdir(destination, { recursive: true });
    for (const name of await this.readdir(source)) await this.cp(posix.join(source, name), posix.join(destination, name), options);
  }
  mv(source: string, destination: string): Promise<void> { return this.replaceFile(source, destination); }
  replaceFile(source: string, destination: string): Promise<void> { return value(this.fs.renameFile(source, destination, BACKGROUND_CONTEXT)); }
  async createExclusive(path: string, options: CreateExclusiveOptions): Promise<void> {
    if (await this.exists(path)) throw new Error(`EEXIST: file already exists, '${path}'`);
    await (options.directory ? this.mkdir(path) : this.writeFile(path, new Uint8Array()));
  }
  resolvePath(base: string, path: string): string { return posix.resolve(base, path); }
  /** Not enumerable synchronously over an asynchronous file system; nothing in the shell needs it. */
  getAllPaths(): string[] { return []; }
  async chmod(path: string): Promise<void> { await this.stats(path); }
  async symlink(_target: string, path: string): Promise<void> { throw new Error(`ENOTSUP: symbolic links are not supported by this file system, '${path}'`); }
  async link(_source: string, path: string): Promise<void> { throw new Error(`ENOTSUP: hard links are not supported by this file system, '${path}'`); }
  async readlink(path: string): Promise<string> { await this.stats(path); throw new Error(`EINVAL: not a symbolic link, '${path}'`); }
  realpath(path: string): Promise<string> { return value(this.fs.canonicalPath(path, BACKGROUND_CONTEXT)); }
  async utimes(path: string): Promise<void> { if (!(await this.stats(path)).isDirectory) await this.appendFile(path, new Uint8Array()); }
}

/** Resolve missing leaves and existing aliases through public upstream filesystem operations. */
export async function mutationPath(fs: IFileSystem, input: string, parents: boolean, followFinal: boolean): Promise<string> {
  if (!input.startsWith('/') || input.includes('\0')) throw new Error('EINVAL: an absolute virtual path is required');
  let parts = posix.normalize(input).split('/').filter(Boolean), current = '/', links = 0;
  while (parts.length) {
    const part = parts.shift();
    if (part === undefined) break;
    const candidate = posix.join(current, part), final = parts.length === 0;
    let stat;
    try { stat = await fs.lstat(candidate); }
    catch (error) {
      if (!(error instanceof Error) || !/\bENOENT\b/.test(error.message)) throw error;
      if (final) return candidate;
      if (!parents) throw error;
      await fs.mkdir(candidate, { recursive: true }); current = candidate; continue;
    }
    if (stat.isSymbolicLink && (!final || followFinal)) {
      if (++links > 40) throw new Error('ELOOP: too many symbolic links');
      parts = posix.resolve(current, await fs.readlink(candidate), ...parts).split('/').filter(Boolean);
      current = '/'; continue;
    }
    if (!final && !stat.isDirectory) throw new Error('ENOTDIR: path ancestor is not a directory');
    current = candidate;
  }
  return current;
}

/** Upstream owns storage. Mutating methods resolve aliases consistently with upstream readers. */
export class VirtualFileSystem extends InMemoryFs {
  private async requireFileTarget(path: string): Promise<void> {
    try {
      if ((await this.lstat(path)).isDirectory) throw new Error('EISDIR: write target is a directory');
    } catch (error) { if (!(error instanceof Error) || !/\bENOENT\b/.test(error.message)) throw error; }
  }
  override async writeFile(path: string, content: FileContent, options?: Parameters<InMemoryFs['writeFile']>[2]): Promise<void> {
    const bytes = typeof content === 'string' ? content : Uint8Array.from(content);
    const target = await mutationPath(this, path, true, true);
    await this.requireFileTarget(target);
    await super.writeFile(target, bytes, options);
  }
  override async appendFile(path: string, content: FileContent, options?: Parameters<InMemoryFs['writeFile']>[2]): Promise<void> {
    const bytes = typeof content === 'string' ? content : Uint8Array.from(content);
    const target = await mutationPath(this, path, true, true);
    await this.requireFileTarget(target);
    await super.appendFile(target, bytes, options);
  }
  override async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const target = await mutationPath(this, path, options?.recursive === true, options?.recursive === true);
    try {
      if (!(await this.lstat(target)).isDirectory) throw new Error('ENOTDIR: mkdir target is not a directory');
    } catch (error) { if (!(error instanceof Error) || !/\bENOENT\b/.test(error.message)) throw error; }
    await super.mkdir(target, options);
  }
  override async rm(path: string, options?: RmOptions): Promise<void> {
    let target;
    try { target = await mutationPath(this, path, false, false); }
    catch (error) { if (options?.force && error instanceof Error && /\bENOENT\b/.test(error.message)) return; throw error; }
    await super.rm(target, options);
  }
  override async createExclusive(path: string, options: Parameters<InMemoryFs['createExclusive']>[1]): Promise<void> {
    await super.createExclusive(await mutationPath(this, path, false, false), options);
  }
  override async mv(_source: string, _destination: string): Promise<void> {
    throw new Error('ENOTSUP: backing move does not preserve native rename semantics');
  }
  /** Move one regular file over a file or a missing path in a single synchronous upstream step, so a reader sees the old or the new bytes. */
  async replaceFile(source: string, destination: string): Promise<void> {
    const from = await mutationPath(this, source, false, false), to = await mutationPath(this, destination, false, true);
    if (!(await this.lstat(from)).isFile) throw new Error('ENOTSUP: only a regular file can be replaced by rename');
    await this.requireFileTarget(to);
    await InMemoryFs.prototype.mv.call(this, from, to);
  }
  override async cp(source: string, destination: string, options?: CpOptions): Promise<void> {
    const from = await mutationPath(this, source, false, false), to = await mutationPath(this, destination, false, true);
    if ((await this.lstat(from)).isDirectory) throw new Error('ENOTSUP: recursive directory copy is not qualified');
    if (await this.exists(to)) {
      if ((await this.stat(to)).isDirectory) throw new Error('EISDIR: copy destination must be a file');
    }
    await super.cp(from, to, options);
  }
  override async symlink(target: string, path: string): Promise<void> {
    await super.symlink(target, await mutationPath(this, path, false, false));
  }
  override async link(_source: string, _destination: string): Promise<void> {
    throw new Error('ENOTSUP: hard links do not preserve shared file identity');
  }
  override async chmod(path: string, mode: number): Promise<void> {
    await super.chmod(await mutationPath(this, path, false, true), mode);
  }
  override async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    await super.utimes(await mutationPath(this, path, false, true), atime, mtime);
  }
}
