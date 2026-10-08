// The one rule for which files on disk a check reads: everything except `.git` and what git ignores (.gitignore,
// .git/info/exclude, the global excludes). Build output, dependencies, caches and tool state such as wrangler's
// `.wrangler/tmp` are ignored there, so no check keeps its own skip list. Untracked files that are not ignored are still
// read, so a new source file is checked before it is committed. Outside a git checkout (a test fixture) nothing is ignored.
import { realpathSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { posix, resolve } from 'node:path';

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

/** A predicate on root-relative POSIX paths: true when git ignores the path or one of its parent directories. */
export function gitIgnored(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(root)) return () => false;
  const listed = git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']);
  if (listed.status !== 0) throw new Error(`git ls-files failed in ${root}: ${listed.stderr}`);
  const ignored = new Set(listed.stdout.split('\0').filter(Boolean).map(path => path.replace(/\/$/, '')));
  return path => {
    for (let at = path; at && at !== '.'; at = posix.dirname(at)) if (ignored.has(at)) return true;
    return false;
  };
}

/**
 * Walks `directory` (root-relative) depth first, calling `visit(entry, path)` for every entry that is neither `.git` nor
 * ignored by git; `path` is root-relative POSIX. Directories are entered unless `visit` returns false; symbolic links are
 * reported but never followed.
 */
export function walkProject(root, directory, visit, ignored = gitIgnored(root)) {
  const walk = folder => {
    for (const entry of readdirSync(resolve(root, folder), { withFileTypes: true })) {
      const path = folder ? posix.join(folder, entry.name) : entry.name;
      if (entry.name === '.git' || ignored(path)) continue;
      const enter = visit(entry, path);
      if (entry.isDirectory() && !entry.isSymbolicLink() && enter !== false) walk(path);
    }
  };
  walk(directory === '.' ? '' : directory);
}
