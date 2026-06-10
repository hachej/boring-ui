import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'

import { EXAMPLE_CSP_POLICY, applyCspHeaders } from '../server/http/csp'

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const repoRoot = resolve(agentRoot, '..', '..')

const auditedFiles = [
  { root: agentRoot, path: 'src/front/chat/PiChatPanel.tsx' },
  { root: agentRoot, path: 'examples/with-custom-tool/client.tsx' },
  { root: repoRoot, path: 'apps/agent-playground/src/front/App.tsx' },
  { root: repoRoot, path: 'apps/agent-playground/src/server/index.ts' },
]

function readFile(root: string, relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf8')
}

describe('CSP policy', () => {
  test('uses strict directives without unsafe-eval', () => {
    expect(EXAMPLE_CSP_POLICY).toContain("default-src 'self'")
    expect(EXAMPLE_CSP_POLICY).toContain("script-src 'self'")
    expect(EXAMPLE_CSP_POLICY).toContain("style-src 'self' 'unsafe-inline'")
    expect(EXAMPLE_CSP_POLICY).not.toContain('unsafe-eval')
  })

  test('applyCspHeaders sets Content-Security-Policy header', () => {
    const setHeader = vi.fn()
    applyCspHeaders({ setHeader })
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      EXAMPLE_CSP_POLICY,
    )
  })
})

describe('CSP-sensitive source audit', () => {
  test('audited files do not use eval/new Function', () => {
    const evalPattern = /\beval\s*\(|\bnew Function\s*\(/
    for (const file of auditedFiles) {
      expect(readFile(file.root, file.path), file.path).not.toMatch(evalPattern)
    }
  })

  test('audited files do not use JSX inline style attributes', () => {
    const inlineStylePattern = /\bstyle=\{\{/
    for (const file of auditedFiles) {
      expect(readFile(file.root, file.path), file.path).not.toMatch(inlineStylePattern)
    }
  })
})
