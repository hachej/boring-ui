import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { INTENTS_RELATIVE_DIR, whereWeAreLine } from './memoryFiles.js'

/**
 * The agent's own standing instructions live in its workspace at
 * `agent/instructions.md`, so the agent can edit them with its ordinary write
 * tool. The loader caches the file and invalidates on change, so the prompt
 * is only rebuilt when the agent (or the user) actually edits it — never per
 * turn, which would defeat prompt caching.
 *
 * The same cache carries the one generated "where were we" line, computed from
 * the memory files (`agent/intents/`, `docs/CHANGES.md`). Those directories are
 * watched for the same reason: the line must be current, but recomputing it on
 * every turn would churn the prompt for no reason.
 */
export const INSTRUCTIONS_RELATIVE_PATH = path.join('agent', 'instructions.md')

export interface InstructionsLoader {
  /** Base prompt + standing instructions + the one "where were we" line. */
  load(): Promise<string | undefined>
  close(): void
}

/** Directories whose contents change the dynamic prompt. */
function watchedDirectories(workspaceRoot: string): string[] {
  return [
    path.join(workspaceRoot, 'agent'),
    path.join(workspaceRoot, INTENTS_RELATIVE_DIR),
    path.join(workspaceRoot, 'docs'),
  ]
}

export function createInstructionsLoader(options: {
  readonly workspaceRoot: string
  readonly basePrompt: string | undefined
}): InstructionsLoader {
  const file = path.join(options.workspaceRoot, INSTRUCTIONS_RELATIVE_PATH)
  let cached: string | undefined | null = null
  const watchers: FSWatcher[] = []

  const invalidate = () => { cached = null }
  for (const dir of watchedDirectories(options.workspaceRoot)) {
    try {
      // Create first: fs.watch cannot attach to a directory that does not exist
      // yet, and these are created lazily by the memory tools.
      mkdirSync(dir, { recursive: true })
      const watcher = watch(dir, { persistent: false }, invalidate)
      watcher.on('error', invalidate)
      watchers.push(watcher)
    } catch {
      // No watcher: fall back to re-reading on each load.
    }
  }
  const watching = watchers.length === watchedDirectories(options.workspaceRoot).length

  return {
    async load() {
      if (cached !== null && watching) return cached
      let instructions = ''
      try {
        instructions = (await readFile(file, 'utf8')).trim()
      } catch {
        instructions = ''
      }
      const where = await whereWeAreLine(options.workspaceRoot)
      const parts = [
        options.basePrompt?.trim() ?? '',
        instructions
          ? `# Your standing instructions (kept in ${INSTRUCTIONS_RELATIVE_PATH}; edit that file to change them)\n\n${instructions}`
          : '',
        where ?? '',
      ].filter(Boolean)
      cached = parts.length ? parts.join('\n\n') : undefined
      return cached
    },
    close() {
      for (const watcher of watchers.splice(0)) watcher.close()
    },
  }
}
