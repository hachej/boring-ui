import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineServerPlugin } from '@hachej/boring-workspace/server'

export const FACTORY_LOOP_PLUGIN_ID = 'factory-loop'

export function createFactoryLoopPlugin() {
  const require = createRequire(import.meta.url)
  const packageJsonPath = require.resolve('pi-mono-loop/package.json')
  const packageRoot = dirname(packageJsonPath)
  const extensionPath = resolve(packageRoot, 'index.ts')
  const contentDigest = `sha256:${createHash('sha256')
    .update(readFileSync(packageJsonPath))
    .update(readFileSync(extensionPath))
    .digest('hex')}`

  return defineServerPlugin({
    id: FACTORY_LOOP_PLUGIN_ID,
    label: 'Factory loop',
    contentDigest,
    agentConfigContract: { keys: [] },
    extensionPaths: [extensionPath],
  })
}
