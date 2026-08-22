import { resolve } from 'node:path'

export const sandboxSourceAlias = {
  find: /^@hachej\/boring-sandbox\/(.+)$/,
  replacement: resolve(import.meta.dirname, '../packages/boring-sandbox/src/$1/index.ts'),
}
