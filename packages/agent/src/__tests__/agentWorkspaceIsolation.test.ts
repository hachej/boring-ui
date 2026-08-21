import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * Ratified invariant: `@hachej/boring-agent` never depends on
 * `@hachej/boring-workspace` — the workspace host injects into the agent, never
 * the reverse. This check is source-level on purpose: the packaged
 * `scripts/check-agent-isolation.ts` scans emitted JS, where `import type`
 * specifiers have already been erased by tsc and a type-only violation would
 * pass silently.
 */
const AGENT_SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const FORBIDDEN = '@hachej/boring-workspace'

/** `from '…'`, bare `import '…'`, `import('…')`, `require('…')` — covers `import type … from '…'`. */
const SPECIFIER_RE = /(?:from\s*|import\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sourceFiles(abs)))
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(abs)
  }
  return out
}

function violations(content: string): string[] {
  const hits: string[] = []
  SPECIFIER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SPECIFIER_RE.exec(content)) !== null) {
    const specifier = match[1]!
    if (specifier === FORBIDDEN || specifier.startsWith(`${FORBIDDEN}/`)) hits.push(specifier)
  }
  return hits
}

describe('agent → workspace isolation', async () => {
  const files = await sourceFiles(AGENT_SRC)

  test('scans a non-empty source tree', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  test('no packages/agent/src file imports @hachej/boring-workspace (type-only included)', async () => {
    const hits: string[] = []
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      for (const specifier of violations(content)) {
        hits.push(`${relative(AGENT_SRC, file)} → ${specifier}`)
      }
    }
    expect(hits).toEqual([])
  })

  test('the detector catches type-only and dynamic import forms', () => {
    expect(violations(`import type { Workspace } from '${FORBIDDEN}'`)).toEqual([FORBIDDEN])
    expect(violations(`import '${FORBIDDEN}/server'`)).toEqual([`${FORBIDDEN}/server`])
    expect(violations(`await import("${FORBIDDEN}")`)).toEqual([FORBIDDEN])
    expect(violations(`require('${FORBIDDEN}')`)).toEqual([FORBIDDEN])
    expect(violations(`// mentions ${FORBIDDEN} in prose only`)).toEqual([])
  })
})
