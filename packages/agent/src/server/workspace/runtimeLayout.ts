import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const BORING_AGENT_GITIGNORE_CONTENT = '*\n'

export const BORING_AGENT_RUNTIME_DIR_NAMES = [
  'node',
  'venv',
  'sdk',
  'skills',
  'cache',
  'tmp',
] as const

export type BoringAgentRuntimeDirName = typeof BORING_AGENT_RUNTIME_DIR_NAMES[number]

export function writeBoringAgentOwnershipMarkerSync(path: string, managedPath: string): void {
  const markerPath = join(path, '.boring-agent-owned.json')
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, `${JSON.stringify({ owner: '@hachej/boring-agent', path: managedPath })}\n`, 'utf8')
}
