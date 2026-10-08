import ignore from 'ignore';
import type { Ignore } from 'ignore';
import type { FileSystem } from '@earendil-works/pi-durable/env';
import type { Context } from '@earendil-works/chord';
import type { ResourceAccess } from './contracts.js';
import { identifier, locator } from './publication-input.js';
import { RevisionError } from './revision-contracts.js';
import type { FileEntry, FilePage, WorkspaceCatalog, SavedRevision } from './revision-contracts.js';

export interface WorkspaceCatalogOptions {
  /** Presentation defaults, never an access policy. False shows dependency/build/internal names and gitignored files. */
  readonly defaults?: boolean;
  /** Additional presentation filtering. Returning false prunes a directory and its descendants. */
  readonly filter?: (entry: FileEntry) => boolean;
  /** A traversal exceeding this bound fails explicitly; it never returns a silently incomplete page. */
  readonly maxEntries?: number;
}
const hidden = new Set(['.git', '.boring', 'node_modules', 'dist', 'build', '.cache', '.next', 'coverage', '__pycache__']);
const temporary = /^\.boring-[0-9a-f-]{36}\.tmp$/;
const inside = (root: string, path: string) => path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
export function catalogPath(path: string, allowRoot = false): string {
  if (allowRoot && path === '') return path;
  return locator({ resource: { providerId: 'catalog', path }, view: { kind: 'published' } }).resource.path;
}
export function createWorkspaceCatalog(options: {
  readonly fs: FileSystem;
  readonly config?: WorkspaceCatalogOptions;
  readonly saves: (path: string) => readonly SavedRevision[];
}): WorkspaceCatalog {
  const { fs } = options, config = options.config ?? {};
  const maximum = config.maxEntries ?? 100_000;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError('Invalid catalog traversal bound');
  const root = fs.cwd.replace(/\/$/, '') || '/';
  const absolute = (path: string) => `${root === '/' ? '' : root}/${path}`;
  const check = (access: ResourceAccess) => { if (access.signal?.aborted) throw new RevisionError('aborted', 'File browsing was cancelled'); };
  const context = (access: ResourceAccess): Context => ({ abortSignal: access.signal, value: () => undefined, toString: () => 'boring-catalog' });
  async function contained(path: string, access: ResourceAccess): Promise<boolean> {
    check(access);
    const base = await fs.canonicalPath(root, context(access));
    const resolved = await fs.canonicalPath(absolute(path), context(access));
    check(access);
    return base.ok && resolved.ok && inside(base.value, resolved.value);
  }
  type Rules = readonly { readonly directory: string; readonly matcher: Ignore }[];
  async function rulesAt(path: string, directory: string, parents: Rules, access: ResourceAccess): Promise<Rules> {
    if (config.defaults === false) return parents;
    const info = await fs.fileInfo(absolute(path), context(access));
    if (!info.ok) {
      if (info.error.code === 'not_found' || info.error.code === 'not_directory') return parents;
      throw new RevisionError('unavailable', 'Ignore rules could not be inspected');
    }
    if (info.value.kind !== 'file' || !await contained(path, access)) throw new RevisionError('denied', 'Ignore rules must be a file inside the workspace');
    if (info.value.size > 1_048_576) throw new RevisionError('unavailable', 'Ignore rules exceed the catalog limit');
    const read = await fs.readBinaryFile(absolute(path), context(access));
    check(access);
    if (!read.ok) throw new RevisionError('unavailable', 'Ignore rules could not be read');
    return [...parents, { directory, matcher: ignore.default().add(new TextDecoder('utf-8', { fatal: true }).decode(read.value)) }];
  }
  function visible(entry: FileEntry, rules: Rules): boolean {
    const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    if (temporary.test(name)) return false;
    if (config.defaults !== false) {
      if (hidden.has(name)) return false;
      let ignored = false;
      for (const rule of rules) {
        const relative = entry.path.slice(rule.directory ? rule.directory.length + 1 : 0) + (entry.kind === 'directory' ? '/' : '');
        const result = rule.matcher.test(relative);
        if (result.ignored) ignored = true;
        else if (result.unignored) ignored = false;
      }
      if (ignored) return false;
    }
    return config.filter?.(entry) !== false;
  }
  async function collect(directory: string, recursive: boolean, access: ResourceAccess): Promise<FileEntry[]> {
    check(access);
    if (!await contained(directory, access)) throw new RevisionError('denied', 'The directory is outside the workspace or unavailable');
    const entries: FileEntry[] = [];
    let scanned = 0;
    async function walk(parent: string, rules: Rules): Promise<void> {
      check(access);
      const own = await rulesAt(parent ? `${parent}/.gitignore` : '.gitignore', parent, rules, access);
      const listing = await fs.listDir(absolute(parent), context(access));
      check(access);
      if (!listing.ok) throw new RevisionError('unavailable', 'The directory could not be listed');
      for (const item of listing.value) {
        check(access);
        if (++scanned > maximum) throw new RevisionError('unavailable', 'The workspace exceeds the catalog traversal limit');
        if (item.kind !== 'file' && item.kind !== 'directory') continue;
        const path = catalogPath(parent ? `${parent}/${item.name}` : item.name);
        const entry: FileEntry = { path, kind: item.kind, size: item.size };
        if (!visible(entry, own)) continue;
        if (!await contained(path, access)) throw new RevisionError('denied', 'A listed entry resolves outside the workspace');
        entries.push(entry);
        if (item.kind === 'directory' && (recursive || directory === path || directory.startsWith(`${path}/`))) await walk(path, own);
      }
    }
    // Walk from the root so parent ignore rules and directory exclusions also apply to a direct nested-directory request.
    let initial: Rules = [];
    if (config.defaults !== false) {
      for (const path of ['.git', '.git/info']) {
        const info = await fs.fileInfo(absolute(path), context(access));
        if (info.ok && info.value.kind === 'symlink') throw new RevisionError('denied', 'Repository ignore rules cannot use symbolic links');
      }
      initial = await rulesAt('.git/info/exclude', '', [], access);
    }
    await walk('', initial);
    if (recursive) return entries;
    return entries.filter(entry => entry.path.slice(0, entry.path.lastIndexOf('/') + 1) === (directory ? `${directory}/` : ''));
  }
  function page(entries: FileEntry[], key: string, cursor: string | undefined, limit: number | undefined): FilePage {
    const count = limit ?? 100;
    if (!Number.isSafeInteger(count) || count < 1 || count > 500) throw new RevisionError('invalid', 'Page limit must be between 1 and 500');
    let after = '';
    if (cursor !== undefined) {
      try {
        const value: unknown = JSON.parse(decodeURIComponent(cursor));
        if (!Array.isArray(value) || value.length !== 2 || value[0] !== key || typeof value[1] !== 'string') throw new Error();
        after = catalogPath(value[1]);
      } catch { throw new RevisionError('invalid', 'Invalid catalog cursor'); }
    }
    const sorted = entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).filter(entry => entry.path > after);
    const selected = sorted.slice(0, count), last = selected.at(-1);
    return { entries: selected, ...(last && sorted.length > count ? { cursor: encodeURIComponent(JSON.stringify([key, last.path])) } : {}) };
  }
  return {
    list: async (request, access) => {
      const directory = catalogPath(request.directory ?? '', true);
      return page(await collect(directory, false, access), `list:${directory}`, request.cursor, request.limit);
    },
    search: async (request, access) => {
      if (typeof request.query !== 'string' || request.query.length > 1024) throw new RevisionError('invalid', 'Invalid filename query');
      const query = request.query.toLowerCase();
      return page((await collect('', true, access)).filter(entry => entry.kind === 'file' && entry.path.toLowerCase().includes(query)), `search:${query}`, request.cursor, request.limit);
    },
    history: async (path, access) => { check(access); identifier(access.scopeId); return options.saves(catalogPath(path)); },
  };
}
