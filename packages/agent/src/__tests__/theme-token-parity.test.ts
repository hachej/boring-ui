// @vitest-environment node

/**
 * Drift guard for the boring theme palette.
 *
 * `@hachej/boring-ui-kit/tokens.css` is the canonical palette. The agent front
 * styles cannot simply import it: the agent package deliberately scopes every
 * token to `[data-boring-agent]` and never writes a `:root` palette, so that
 * embedding hosts keep ownership of their own `--boring-*` values regardless of
 * CSS import order. The agent therefore restates the canonical values as
 * `var(--boring-x, <literal>)` fallbacks, which is what keeps a standalone
 * agent pane (CLI front, agent playground) themed with no workspace CSS loaded.
 *
 * Those literals are a copy by construction, so they need a guard rather than a
 * dedup. This test parses both palettes into token maps and compares them by
 * value, so it survives reformatting and reports the exact token that drifted.
 *
 * Background: the dark `--accent` / `--accent-foreground` / `--ring` fallbacks
 * sat one revision behind the canonical palette for ~3 months because commit
 * 55070acb6 was never propagated here, rendering standalone dark panes with the
 * wrong accent.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..', '..')

const UI_KIT_TOKENS = resolve(ROOT, 'packages/ui/src/tokens.css')
const WORKSPACE_GLOBALS = resolve(ROOT, 'packages/workspace/src/globals.css')
const AGENT_GLOBALS = resolve(ROOT, 'packages/agent/src/front/styles/globals.css')
const PLAYGROUND_APP_CSS = resolve(ROOT, 'apps/agent-playground/src/front/app.css')
const PLAYGROUND_APP_TSX = resolve(ROOT, 'apps/agent-playground/src/front/App.tsx')

const read = (path: string) => readFileSync(path, 'utf8')

/**
 * Tokens excluded from parity, each with the reason it legitimately differs.
 * An entry here must still actually diverge — see the "stays honest" test — so
 * a drift that later gets fixed cannot hide behind a stale exemption.
 */
const INTENTIONAL_DIVERGENCES: Record<string, string> = {
  popover:
    "agent popovers sit lifted off the pane background (agent dark --popover matches its own --surface-chat). Authored alongside the workspace value in 3d81367ca9, not drifted from it.",
}

/** Non-color tokens whose values are structural, not palette. */
const IGNORED_PREFIXES = /^(radius|font|boring-agent-)/

/** Body of a top-level CSS rule, matched on an exact selector. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`selector not found in CSS: ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  if (close < 0) throw new Error(`unterminated rule for selector: ${selector}`)
  return css.slice(open + 1, close)
}

/** Canonical form: `--boring-x: <value>;` */
function parseCanonicalTokens(body: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const match of body.matchAll(/^\s*--boring-([a-z0-9-]+):\s*([^;]+);/gm)) {
    const [, name, value] = match
    if (IGNORED_PREFIXES.test(name)) continue
    tokens.set(name, value.trim())
  }
  return tokens
}

/** Agent fallback form: `--x: var(--boring-x, <value>);` */
function parseFallbackTokens(body: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const match of body.matchAll(
    /^\s*--([a-z0-9-]+):\s*var\(--boring-\1,\s*([\s\S]*?)\);\s*$/gm,
  )) {
    const [, name, value] = match
    if (IGNORED_PREFIXES.test(name)) continue
    tokens.set(name, value.trim())
  }
  return tokens
}

/** Agent literal form: `--x: <value>;` */
function parseLiteralTokens(body: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const match of body.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)) {
    const [, name, value] = match
    if (IGNORED_PREFIXES.test(name)) continue
    if (value.trim().startsWith('var(')) continue
    tokens.set(name, value.trim())
  }
  return tokens
}

/**
 * Compare the tokens the two palettes have in common. The agent intentionally
 * carries a subset (no --success*, no --surface-workbench*), so missing tokens
 * are not drift; differing values are.
 */
function findDrift(canonical: Map<string, string>, actual: Map<string, string>) {
  const drift: { token: string; canonical: string; actual: string }[] = []
  for (const [token, canonicalValue] of canonical) {
    if (token in INTENTIONAL_DIVERGENCES) continue
    const actualValue = actual.get(token)
    if (actualValue === undefined) continue
    if (actualValue !== canonicalValue) {
      drift.push({ token, canonical: canonicalValue, actual: actualValue })
    }
  }
  return drift
}

function formatDrift(
  label: string,
  drift: { token: string; canonical: string; actual: string }[],
) {
  return [
    `${drift.length} token(s) drifted from the canonical ui-kit palette in ${label}:`,
    ...drift.map(
      (d) =>
        `  --${d.token}\n` +
        `    canonical (packages/ui/src/tokens.css): ${d.canonical}\n` +
        `    actual    (${label}):                   ${d.actual}`,
    ),
    '',
    'Update the agent value to match packages/ui/src/tokens.css, or — if the',
    'divergence is deliberate — add the token to INTENTIONAL_DIVERGENCES in',
    'this file with the reason.',
  ].join('\n')
}

describe('theme palette parity with ui-kit tokens.css', () => {
  const uiKit = read(UI_KIT_TOKENS)
  const agent = read(AGENT_GLOBALS)

  const canonicalLight = parseCanonicalTokens(ruleBody(uiKit, ':root'))
  const canonicalDark = parseCanonicalTokens(ruleBody(uiKit, '[data-theme="dark"]'))

  test('the canonical palette parses to a non-trivial token set', () => {
    // Guards the parser itself: a regex that silently matches nothing would
    // make every parity assertion below vacuously pass.
    expect(canonicalLight.size).toBeGreaterThan(15)
    expect(canonicalDark.size).toBeGreaterThan(15)
    expect(canonicalDark.get('accent')).toBe('oklch(0.72 0.13 65)')
  })

  test('workspace globals.css matches ui-kit tokens.css', () => {
    const workspace = read(WORKSPACE_GLOBALS)
    for (const [selector, canonical] of [
      [':root', canonicalLight],
      ['[data-theme="dark"]', canonicalDark],
    ] as const) {
      const actual = parseCanonicalTokens(ruleBody(workspace, selector))
      const drift = findDrift(canonical, actual)
      expect(drift, formatDrift(`workspace globals.css ${selector}`, drift)).toEqual([])
    }
  })

  test('agent light fallbacks match the canonical light palette', () => {
    const actual = parseFallbackTokens(ruleBody(agent, '[data-boring-agent]'))
    expect(actual.size).toBeGreaterThan(15)
    const drift = findDrift(canonicalLight, actual)
    expect(drift, formatDrift('agent [data-boring-agent]', drift)).toEqual([])
  })

  test('agent dark fallbacks match the canonical dark palette', () => {
    const actual = parseFallbackTokens(
      ruleBody(agent, '[data-theme="dark"] [data-boring-agent]'),
    )
    expect(actual.size).toBeGreaterThan(15)
    const drift = findDrift(canonicalDark, actual)
    expect(
      drift,
      formatDrift('agent [data-theme="dark"] [data-boring-agent]', drift),
    ).toEqual([])
  })

  test('agent standalone dark literals match the canonical dark palette', () => {
    const actual = parseLiteralTokens(ruleBody(agent, '[data-theme="dark"]'))
    expect(actual.size).toBeGreaterThan(15)
    const drift = findDrift(canonicalDark, actual)
    expect(drift, formatDrift('agent [data-theme="dark"]', drift)).toEqual([])
  })

  test('the INTENTIONAL_DIVERGENCES allowlist stays honest', () => {
    const darkFallbacks = parseFallbackTokens(
      ruleBody(agent, '[data-theme="dark"] [data-boring-agent]'),
    )
    for (const token of Object.keys(INTENTIONAL_DIVERGENCES)) {
      const canonical = canonicalDark.get(token)
      const actual = darkFallbacks.get(token)
      expect(
        canonical !== undefined && actual !== undefined && canonical !== actual,
        `--${token} is listed in INTENTIONAL_DIVERGENCES but no longer diverges ` +
          `from the canonical palette (canonical: ${canonical}, agent: ${actual}). ` +
          `Remove the exemption so the token is covered by the parity guard.`,
      ).toBe(true)
    }
  })
})

describe('dark-mode selector agreement', () => {
  // The palettes all key on [data-theme="dark"]. A surface that keys its
  // Tailwind dark variant on .dark, or that toggles only the .dark class,
  // swaps utility colors without swapping token surfaces — the mismatch that
  // produced the white-on-white agent subtree incident.
  test('agent-playground keys its dark variant on data-theme, not .dark', () => {
    const css = read(PLAYGROUND_APP_CSS)
    const customVariant = css.match(/@custom-variant\s+dark\s*\(([^)]*\))\s*\)?/)
    expect(customVariant?.[1]).toBeDefined()
    expect(customVariant?.[1]).toContain('[data-theme="dark"]')
    expect(customVariant?.[1]).not.toMatch(/\.dark\b/)
  })

  test('agent-playground sets data-theme when applying a theme', () => {
    const tsx = read(PLAYGROUND_APP_TSX)
    expect(
      tsx,
      'agent-playground must set data-theme on documentElement; the token ' +
        'palettes it imports key on [data-theme="dark"], so toggling only the ' +
        '.dark class leaves the pane half-themed.',
    ).toMatch(/setAttribute\(\s*['"]data-theme['"]/)
  })
})
