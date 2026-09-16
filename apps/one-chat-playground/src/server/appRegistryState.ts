import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { OneChatApp } from './appRegistry.js'

interface RegistryFile {
  readonly apps: readonly OneChatApp[]
}

/** Host control-plane state. This file never reads or writes an app workspace. */
export function createAppRegistryState(appsRoot: string) {
  const registryPath = path.join(appsRoot, 'apps.json')
  return {
    async initRoot() {
      await mkdir(appsRoot, { recursive: true })
    },
    async read(): Promise<RegistryFile | undefined> {
      try {
        return JSON.parse(await readFile(registryPath, 'utf8')) as RegistryFile
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async write(body: RegistryFile): Promise<void> {
      const temporary = `${registryPath}.tmp`
      await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
      await rename(temporary, registryPath)
    },
  }
}
