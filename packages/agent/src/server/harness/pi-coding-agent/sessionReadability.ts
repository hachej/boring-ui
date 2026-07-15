import type { FileEntry } from '@mariozechner/pi-coding-agent'

export interface PiSessionTranscriptReadabilityInput {
  filePath: string
  sessionDir: string
  runtimeCwd: string
  expectedHeaderId: string
  headerVersion: number
  entries: readonly unknown[]
}

/** Validate an offline transcript through the same Pi loader/migrations used in production. */
export async function isPiSessionTranscriptReadable(input: PiSessionTranscriptReadabilityInput): Promise<boolean> {
  try {
    const {
      CURRENT_SESSION_VERSION,
      migrateSessionEntries,
      SessionManager,
    } = await import('@mariozechner/pi-coding-agent')
    if (input.headerVersion < CURRENT_SESSION_VERSION) {
      const entries = structuredClone(input.entries) as FileEntry[]
      migrateSessionEntries(entries)
      const header = entries[0]
      return header?.type === 'session' && header.id === input.expectedHeaderId
        && header.version === CURRENT_SESSION_VERSION
        && entries.some((entry) => entry.type === 'message')
    }
    const manager = SessionManager.open(input.filePath, input.sessionDir, input.runtimeCwd)
    return manager.getHeader()?.id === input.expectedHeaderId
      && manager.getEntries().some((entry) => entry.type === 'message')
  } catch {
    return false
  }
}
