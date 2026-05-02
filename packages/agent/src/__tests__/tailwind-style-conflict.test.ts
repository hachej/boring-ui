import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const WORKSPACE_GLOBALS = resolve(ROOT, 'packages/workspace/src/globals.css')
const AGENT_SHADCN_STYLES = resolve(ROOT, 'packages/agent/src/front/styles/globals.css')

function extractCssVarNames(css: string, selector: string): string[] {
  const pattern = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}',
    'g',
  )
  const vars: string[] = []
  let match = pattern.exec(css)
  while (match) {
    const block = match[1]
    for (const line of block.split('\n')) {
      const varMatch = line.match(/^\s*(--[\w-]+)\s*:/)
      if (varMatch) vars.push(varMatch[1])
    }
    match = pattern.exec(css)
  }
  return vars
}

function readCss(path: string): string {
  return readFileSync(path, 'utf-8')
}

function listFiles(dir: string, exts = new Set(['.ts', '.tsx', '.css'])): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...listFiles(path, exts))
    else if (exts.has(path.slice(path.lastIndexOf('.')))) out.push(path)
  }
  return out
}

describe('Tailwind v4 style contract', () => {
  const workspaceCss = readCss(WORKSPACE_GLOBALS)
  const agentCss = readCss(AGENT_SHADCN_STYLES)

  test('workspace owns public --boring-* base tokens at :root', () => {
    const workspaceVars = extractCssVarNames(workspaceCss, ':root')

    expect(workspaceVars).toContain('--boring-background')
    expect(workspaceVars).toContain('--boring-foreground')
    expect(workspaceVars).toContain('--boring-primary')
    expect(workspaceVars).toContain('--boring-border')
  })

  test('workspace bridges public tokens to internal shadcn aliases', () => {
    expect(workspaceCss).toMatch(/--background:\s*var\(--boring-background\)/)
    expect(workspaceCss).toMatch(/--foreground:\s*var\(--boring-foreground\)/)
    expect(workspaceCss).toMatch(/--primary:\s*var\(--boring-primary\)/)
    expect(workspaceCss).toMatch(/--border:\s*var\(--boring-border\)/)
  })

  test('agent consumes host --boring-* tokens under its public root', () => {
    expect(agentCss).toMatch(/\[data-boring-agent\]\s*{[\s\S]*--background:\s*var\(--boring-background,/)
    expect(agentCss).toMatch(/\[data-boring-agent\]\s*{[\s\S]*--foreground:\s*var\(--boring-foreground,/)
    expect(agentCss).toMatch(/\[data-boring-agent\]\s*{[\s\S]*--primary:\s*var\(--boring-primary,/)
    expect(agentCss).toMatch(/\[data-boring-agent\]\s*{[\s\S]*--border:\s*var\(--boring-border,/)
  })

  test('agent does not define global :root tokens', () => {
    expect(extractCssVarNames(agentCss, ':root')).toHaveLength(0)
  })

  test('agent source CSS omits Tailwind preflight/base reset', () => {
    const uncommented = agentCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(uncommented).not.toMatch(/@import\s+["']tailwindcss["']/)
    expect(uncommented).not.toMatch(/@import\s+["']tailwindcss\/preflight\.css["']/)
    expect(uncommented).not.toMatch(/@layer\s+base/)
  })

  test('workspace keeps reset/base layer ownership', () => {
    expect(workspaceCss).toMatch(/@layer\s+base/)
    expect(workspaceCss).toMatch(/border-border/)
  })

  test('dark mode is tokenized by workspace and inherited by agent', () => {
    const workspaceDarkVars = extractCssVarNames(workspaceCss, '.dark')

    expect(workspaceDarkVars).toContain('--boring-background')
    expect(workspaceDarkVars).toContain('--boring-foreground')
    expect(agentCss).toMatch(/\.dark \[data-boring-agent\]/)
    expect(agentCss).toMatch(/--background:\s*var\(--boring-background,/)
  })

  test('front source has no stale boring-chat namespace', () => {
    const offenders = listFiles(resolve(ROOT, 'packages/agent/src/front'))
      .filter((file) => /boring-chat/.test(readFileSync(file, 'utf-8')))
      .map((file) => file.replace(`${ROOT}/`, ''))

    expect(offenders).toEqual([])
  })

  test('agent component tokens have package defaults', () => {
    const sourceFiles = listFiles(resolve(ROOT, 'packages/agent/src/front'), new Set(['.ts', '.tsx']))
    const consumed = new Set<string>()
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf-8')
      for (const match of content.matchAll(/--boring-agent-[\w-]+/g)) {
        consumed.add(match[0])
      }
    }

    const defined = new Set(
      [...agentCss.matchAll(/(?:^|[\s{;])(--boring-agent-[\w-]+)\s*:/gm)].map(
        (match) => match[1],
      ),
    )
    const missing = [...consumed].filter((token) => !defined.has(token)).sort()

    expect(missing).toEqual([])
  })

  test('child apps do not scan package source CSS', () => {
    const offenders = listFiles(resolve(ROOT, 'apps'), new Set(['.css']))
      .filter((file) => /@source\s+["'][^"']*packages\/(agent|workspace)\/src/.test(readFileSync(file, 'utf-8')))
      .map((file) => file.replace(`${ROOT}/`, ''))

    expect(offenders).toEqual([])
  })
})
