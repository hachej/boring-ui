import path from 'node:path'

import type { Workspace } from '@hachej/boring-agent/shared'

import { CHANGES_RELATIVE_PATH, INTENTS_RELATIVE_DIR, whereWeAreLine } from './memoryFiles.js'

/** The agent-owned standing instructions inside the runtime workspace. */
export const INSTRUCTIONS_RELATIVE_PATH = path.join('agent', 'instructions.md')

export interface InstructionsLoader {
  /** Base prompt + standing instructions + the one "where were we" line. */
  load(): Promise<string | undefined>
  /** Direct invalidation for host tools that just changed a tracked file. */
  invalidate(): void
  close(): void
}

interface PromptMtimes {
  readonly instructions?: number
  readonly intentsFingerprint: string
  readonly changes?: number
}

async function mtime(workspace: Workspace, relativePath: string): Promise<number | undefined> {
  try {
    return (await workspace.stat(relativePath)).mtimeMs
  } catch {
    return undefined
  }
}

async function intentsFingerprint(workspace: Workspace): Promise<string> {
  try {
    const files = (await workspace.readdir(INTENTS_RELATIVE_DIR))
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
    const mtimes = await Promise.all(files.map(async (file) => [file, await mtime(workspace, path.join(INTENTS_RELATIVE_DIR, file))] as const))
    return JSON.stringify(mtimes)
  } catch {
    return '[]'
  }
}

function sameMtimes(left: PromptMtimes | undefined, right: PromptMtimes): boolean {
  return (
    left !== undefined && left.instructions === right.instructions && left.intentsFingerprint === right.intentsFingerprint && left.changes === right.changes
  )
}

/**
 * Prompt changes are detected only through the runtime Workspace adapter. A
 * stable cache is checked with cheap stats before every turn; no host watcher
 * or direct filesystem read participates.
 */
export function createInstructionsLoader(options: { readonly workspace: Workspace; readonly basePrompt: string | undefined }): InstructionsLoader {
  let cached: string | undefined
  let cachedMtimes: PromptMtimes | undefined
  let dirty = true

  const observedMtimes = async (): Promise<PromptMtimes> => ({
    instructions: await mtime(options.workspace, INSTRUCTIONS_RELATIVE_PATH),
    intentsFingerprint: await intentsFingerprint(options.workspace),
    changes: await mtime(options.workspace, CHANGES_RELATIVE_PATH),
  })

  return {
    async load() {
      const observed = await observedMtimes()
      if (!dirty && sameMtimes(cachedMtimes, observed)) return cached

      let instructions = ''
      try {
        instructions = (await options.workspace.readFile(INSTRUCTIONS_RELATIVE_PATH)).trim()
      } catch {
        instructions = ''
      }
      const where = await whereWeAreLine(options.workspace)
      const parts = [
        options.basePrompt?.trim() ?? '',
        instructions ? `# Your standing instructions (kept in ${INSTRUCTIONS_RELATIVE_PATH}; edit that file to change them)\n\n${instructions}` : '',
        where ?? '',
      ].filter(Boolean)
      cached = parts.length ? parts.join('\n\n') : undefined
      // Cache the snapshot observed before rendering. If anything changes while
      // this prompt is being read, the next load sees a different fingerprint
      // and rebuilds instead of associating stale text with newer mtimes.
      cachedMtimes = observed
      dirty = false
      return cached
    },
    invalidate() {
      dirty = true
    },
    close() {},
  }
}
