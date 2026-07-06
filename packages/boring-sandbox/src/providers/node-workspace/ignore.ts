/**
 * Directory/file names that are heavy and rarely useful to descend into.
 *
 * Kept provider-local so node workspace watching does not import agent server
 * values after the provider move.
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

export function isIgnoredDirName(name: string): boolean {
  return IGNORED_SET.has(name) || name.endsWith('.tsbuildinfo')
}
