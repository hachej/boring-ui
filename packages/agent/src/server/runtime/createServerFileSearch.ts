import type { FileSearch } from '../../shared/file-search'
import type { Sandbox } from '../../shared/sandbox'
import type { Workspace } from '../../shared/workspace'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 5_000
const SEARCH_TIMEOUT_MS = 5_000
const SEARCH_MAX_OUTPUT_BYTES = 256_000

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT
  }

  const normalized = Math.trunc(limit)
  if (normalized <= 0) return DEFAULT_LIMIT
  return Math.min(normalized, MAX_LIMIT)
}

export function createServerFileSearch(
  workspace: Workspace,
  sandbox: Sandbox,
): FileSearch {
  return {
    async search(glob, limit = DEFAULT_LIMIT) {
      const safeLimit = normalizeLimit(limit)
      const command = [
        'find .',
        '-maxdepth 10',
        `-name ${shellQuote(glob)}`,
        '-type f',
        `| head -n ${safeLimit}`,
      ].join(' ')

      const { stdout, exitCode } = await sandbox.exec(command, {
        cwd: workspace.root,
        timeoutMs: SEARCH_TIMEOUT_MS,
        maxOutputBytes: SEARCH_MAX_OUTPUT_BYTES,
      })

      if (exitCode !== 0) {
        throw new Error(`file-search failed: exit ${exitCode}`)
      }

      const decoded = new TextDecoder().decode(stdout)
      return decoded
        .split('\n')
        .map((line) => line.replace(/\r$/, ''))
        .filter((line) => line.length > 0)
        .map((line) => line.replace(/^\.\//, ''))
    },
  }
}
