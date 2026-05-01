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

// Translate the kind of globs LLMs typically emit (globstar paths like
// "src/<globstar>/foo.ts" or just "package.json") into a `find` invocation
// that actually matches.
//
// `find -iname <pat>` only matches the BASENAME — it has no concept of
// path segments — and `find -ipath <pat>` doesn't understand the
// double-asterisk globstar (find treats it as two literal asterisks,
// which fails to match anything). LLMs default to globstar/path globs,
// which is how the "no files found" reports kept surfacing.
//
// Heuristic:
//   - bare basename ("*.ts", "package.json", "Dockerfile") → -iname <pat>
//   - path-shaped ("src/*.ts", "<globstar>/foo.ts") → -ipath, with the
//     globstar collapsed to a single `*` so find recurses, prefixed
//     with `*` so it matches anywhere under cwd unless already anchored.
function buildFindArgs(glob: string): string {
  const isPathShaped = glob.includes('/') || glob.includes('**')
  if (!isPathShaped) {
    return `-iname ${shellQuote(glob)}`
  }

  // `find -ipath` matches the FULL path of each candidate (including
  // leading `./`). `*` inside a `-ipath` arg matches across `/` so we
  // translate `**` → `*` (idempotent: a single `*` is the recursive
  // form). Ensure the pattern matches anywhere by prefixing `*` when
  // the glob is not already anchored — this covers both "src/foo.ts"
  // (becomes "*src/foo.ts" → matches "./src/foo.ts") AND files at the
  // workspace root ("./src/foo.ts" begins with `./`, leading `*`
  // consumes that).
  let translated = glob.replaceAll('**', '*')
  translated = translated.replace(/^\/+/, '')
  if (!translated.startsWith('*')) {
    translated = `*${translated}`
  }
  return `-ipath ${shellQuote(translated)}`
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
        buildFindArgs(glob),
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
