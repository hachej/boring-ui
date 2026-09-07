import { resolve } from 'node:path'

export const sandboxSourceSubpaths = [
  'shared',
  'providers',
  'providers/direct',
  'providers/bwrap',
  'providers/node-workspace',
  'providers/blaxel',
  'providers/vercel-sandbox',
  'providers/runsc',
  'providers/remote-worker',
] as const

const sandboxSourceSubpathPattern = sandboxSourceSubpaths.join('|').replaceAll('/', '\\/')

export const sandboxSourceAlias = {
  find: new RegExp(`^@hachej/boring-sandbox/(${sandboxSourceSubpathPattern})$`),
  replacement: resolve(import.meta.dirname, '../packages/boring-sandbox/src/$1/index.ts'),
}
