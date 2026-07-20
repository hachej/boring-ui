/**
 * Directory/file names that are heavy and rarely useful to descend into.
 *
 * Single source of truth shared by the filesystem watcher (which skips them
 * during chokidar's recursive scan) and the tree route (which lists them as
 * entries but does NOT auto-recurse into them). Keeping these in one place
 * ensures "what the watcher prunes" and "what the recursive tree prunes" stay
 * identical.
 *
 * On a repo with ~100 worktrees under `.worktrees/`, each containing
 * `node_modules`, an unfiltered recursive tree walk both takes seconds and
 * exhausts the entry-count budget on junk before reaching real source files.
 */
export const DEFAULT_IGNORED_DIR_NAMES = [
  'node_modules',
  '.git',
  '.DS_Store',
  '.worktrees',
  '.boring-agent',
  '.cache',
  'dist',
  '.next',
  '.turbo',
  'test-results',
] as const

const IGNORED_SET: ReadonlySet<string> = new Set(DEFAULT_IGNORED_DIR_NAMES)

/**
 * True when a single path segment (not a full path) should be treated as an
 * ignored/heavy directory.
 */
export function isIgnoredDirName(name: string): boolean {
  return IGNORED_SET.has(name) || name.endsWith('.tsbuildinfo')
}
