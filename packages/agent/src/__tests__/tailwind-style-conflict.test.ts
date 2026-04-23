import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const WORKSPACE_GLOBALS = resolve(ROOT, 'packages/workspace/src/globals.css')
const AGENT_SHADCN_STYLES = resolve(ROOT, 'packages/agent/src/front-shadcn/styles/globals.css')
const AGENT_THEME_CSS = resolve(ROOT, 'packages/agent/src/front/styles/theme.css')

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

describe('Tailwind v4 style isolation (qs8)', () => {
  const workspaceCss = readCss(WORKSPACE_GLOBALS)
  const agentShadcnCss = readCss(AGENT_SHADCN_STYLES)
  const agentThemeCss = readCss(AGENT_THEME_CSS)

  test('documents overlapping :root variable names between workspace and agent/ui-shadcn', () => {
    const workspaceVars = extractCssVarNames(workspaceCss, ':root')
    const agentVars = extractCssVarNames(agentShadcnCss, ':root')

    const overlap = workspaceVars.filter((v) => agentVars.includes(v))

    expect(overlap.length).toBeGreaterThan(0)
    expect(overlap).toContain('--background')
    expect(overlap).toContain('--primary')
    expect(overlap).toContain('--border')
  })

  test('workspace uses oklch format, agent/ui-shadcn uses HSL — format mismatch', () => {
    const workspaceHasOklch = /--background:\s*oklch\(/.test(workspaceCss)
    const agentHasRawHsl = /--background:\s*\d+\s+\d+%\s+\d+%/.test(agentShadcnCss)

    expect(workspaceHasOklch).toBe(true)
    expect(agentHasRawHsl).toBe(true)
  })

  test('agent bare theme.css uses only --boring-chat-* variables (no collisions)', () => {
    const vars = extractCssVarNames(agentThemeCss, '[data-boring-chat]')

    expect(vars.length).toBeGreaterThan(0)
    for (const v of vars) {
      expect(v).toMatch(/^--boring-chat-/)
    }
  })

  test('agent/ui-shadcn styles.css does not import tailwindcss outside comments', () => {
    const uncommented = agentShadcnCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(uncommented).not.toMatch(/@import\s+['"]tailwindcss['"]/)
  })

  test('agent/ui-shadcn styles.css has no @layer base (no double-reset risk)', () => {
    expect(agentShadcnCss).not.toMatch(/@layer\s+base/)
  })

  test('workspace globals.css has @layer base with border-border reset', () => {
    expect(workspaceCss).toMatch(/@layer\s+base/)
    expect(workspaceCss).toMatch(/border-border/)
  })

  test('both define .dark selector with different values', () => {
    const workspaceDarkVars = extractCssVarNames(workspaceCss, '.dark')
    const agentDarkVars = extractCssVarNames(agentShadcnCss, '.dark')

    const overlap = workspaceDarkVars.filter((v) => agentDarkVars.includes(v))
    expect(overlap.length).toBeGreaterThan(0)
    expect(overlap).toContain('--background')
  })
})
