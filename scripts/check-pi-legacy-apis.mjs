#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const sourceRoots = ['apps', 'packages', 'plugins']
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const excludedDirectories = new Set(['__tests__', 'dist', 'node_modules', 'test-fixtures'])
const legacyApiPattern = /\b(?:AuthStorage|ModelRegistry)\b/g
const failures = []

function extensionOf(path) {
  const name = path.slice(path.lastIndexOf(sep) + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot)
}

function isProductionSourceFile(path) {
  const segments = relative(repoRoot, path).split(sep)
  if (!segments.includes('src')) return false
  const name = segments.at(-1) ?? ''
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)) return false
  return sourceExtensions.has(extensionOf(path))
}

async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) {
      await scan(child)
      continue
    }
    if (!entry.isFile() || !isProductionSourceFile(child)) continue

    const source = await readFile(child, 'utf8')
    for (const match of source.matchAll(legacyApiPattern)) {
      const line = source.slice(0, match.index).split('\n').length
      failures.push(`${relative(repoRoot, child)}:${line}: ${match[0]}`)
    }
  }
}

for (const root of sourceRoots) await scan(resolve(repoRoot, root))

if (failures.length > 0) {
  console.error('[pi-legacy-apis] removed Pi model APIs remain in production source:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exitCode = 1
} else {
  console.log('[pi-legacy-apis] OK: no AuthStorage or ModelRegistry in production monorepo source')
}
