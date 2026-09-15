import { watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * The agent's own standing instructions live in its workspace at
 * `agent/instructions.md`, so the agent can edit them with its ordinary write
 * tool. The loader caches the file and invalidates on change, so the prompt
 * is only rebuilt when the agent (or the user) actually edits it — never per
 * turn, which would defeat prompt caching.
 */
export const INSTRUCTIONS_RELATIVE_PATH = path.join('agent', 'instructions.md')

export interface InstructionsLoader {
  /** Base (host-owned) prompt plus the current standing instructions. */
  load(): Promise<string | undefined>
  close(): void
}

export function createInstructionsLoader(options: {
  readonly workspaceRoot: string
  readonly basePrompt: string | undefined
}): InstructionsLoader {
  const file = path.join(options.workspaceRoot, INSTRUCTIONS_RELATIVE_PATH)
  const dir = path.dirname(file)
  let cached: string | undefined | null = null
  let watcher: FSWatcher | null = null

  const invalidate = () => { cached = null }
  try {
    watcher = watch(dir, { persistent: false }, invalidate)
    watcher.on('error', invalidate)
  } catch {
    // No watcher (directory missing yet): fall back to re-reading on each load.
  }

  return {
    async load() {
      if (cached !== null && watcher) return cached
      let instructions = ''
      try {
        instructions = (await readFile(file, 'utf8')).trim()
      } catch {
        instructions = ''
      }
      const parts = [options.basePrompt?.trim() ?? '', instructions
        ? `# Your standing instructions (kept in ${INSTRUCTIONS_RELATIVE_PATH}; edit that file to change them)\n\n${instructions}`
        : ''].filter(Boolean)
      cached = parts.length ? parts.join('\n\n') : undefined
      return cached
    },
    close() {
      watcher?.close()
      watcher = null
    },
  }
}
