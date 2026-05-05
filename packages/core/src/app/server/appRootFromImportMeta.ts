import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function appRootFromImportMeta(importMetaUrl: string, levelsUp = 2): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '../'.repeat(levelsUp))
}
