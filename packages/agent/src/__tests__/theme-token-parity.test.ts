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
 *
 * Scope: these exemptions apply ONLY to the two agent-dark comparisons.
 * The workspace palettes and the agent light palette must match the
 * canonical values exactly — a divergence there is always drift.
 * An entry here must still actually diverge — see the "stays honest" test — so
 * a drift that later gets fixed cannot hide behind a stale exemption.
 */
const AGENT_DARK_INTENTIONAL_DIVERGENCES: Record<string, string> = {
  popover:
    "agent popovers sit lifted off the pane background (agent dark --popover matches its own --surface-chat). Authored alongside the workspace value in 3d81367ca9, not drifted from it.",
}

/**
 * Agent-local tokens with no canonical counterpart are always drift — there
 * are none today, and any new one must join the canonical palette or be
 * explicitly justified here. (Named empty set so call sites read clearly.)
 */
const AGENT_EXTRA_TOKENS = new Set<string>([])

/**
 * Canonical tokens each agent surface deliberately does NOT restate (the
 * embedding host or unused semantic slots own them). Anything else missing
 * from an agent palette is drift — this is what catches deletions/renames.
 */
const AGENT_LIGHT_ALLOWED_MISSING = new Set([
  'success',
  'success-foreground',
  'success-soft',
  'surface-workbench',
  'surface-workbench-left',
])

const AGENT_DARK_ALLOWED_MISSING = new Set([
  'destructive',
  'destructive-foreground',
  'success',
  'success-foreground',
  'success-soft',
  'surface-workbench',
  'surface-workbench-left',
])

// The standalone literal block additionally omits --surface-chat.
const AGENT_DARK_LITERAL_ALLOWED_MISSING = new Set([
  ...AGENT_DARK_ALLOWED_MISSING,
  'surface-chat',
])

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

type DriftEntry =
  | { kind: 'missing'; token: string; canonical: string }
  | { kind: 'unexpected'; token: string; canonical: null; actual: string }
  | { kind: 'mismatch'; token: string; canonical: string; actual: string }

interface DriftOptions {
  /** Canonical tokens this target may omit (none by default). */
  allowedMissing?: ReadonlySet<string>
  /** Actual tokens permitted despite having no canonical counterpart. */
  allowUnexpected?: ReadonlySet<string>
  /** Canonical tokens whose values may differ at this target. */
  intentional?: ReadonlySet<string>
}

/**
 * Exact-set parity check. A token counts as drift when it is missing from the
 * actual palette (deletion/rename), present without a canonical counterpart
 * (unless explicitly allowed), or its value differs (unless the divergence is
 * intentional AT THIS TARGET — see AGENT_DARK_INTENTIONAL_DIVERGENCES).
 */
function findDrift(
  canonical: Map<string, string>,
  actual: Map<string, string>,
  options: DriftOptions = {},
): DriftEntry[] {
  const { allowedMissing, allowUnexpected, intentional } = options
  const drift: DriftEntry[] = []
  for (const [token, canonicalValue] of canonical) {
    const actualValue = actual.get(token)
    if (actualValue === undefined) {
      if (!allowedMissing?.has(token)) {
        drift.push({ kind: 'missing', token, canonical: canonicalValue })
      }
      continue
    }
    if (actualValue !== canonicalValue && !intentional?.has(token)) {
      drift.push({ kind: 'mismatch', token, canonical: canonicalValue, actual: actualValue })
    }
  }
  for (const [token, actualValue] of actual) {
    if (!canonical.has(token) && !allowUnexpected?.has(token)) {
      drift.push({ kind: 'unexpected', token, canonical: null, actual: actualValue })
    }
  }
  return drift
}

function formatDrift(label: string, drift: DriftEntry[]) {
  return [
    `${drift.length} token(s) drifted from the canonical ui-kit palette in ${label}:`,
    ...drift.map((d) => {
      if (d.kind === 'missing') {
        return (
          `  --${d.token} MISSING\n` +
          `    expected (packages/ui/src/tokens.css): ${d.canonical}`
        )
      }
      if (d.kind === 'unexpected') {
        return (
          `  --${d.token} UNEXPECTED (no canonical counterpart)\n` +
          `    actual (${label}): ${d.actual}`
        )
      }
      return (
        `  --${d.token}\n` +
        `    canonical (packages/ui/src/tokens.css): ${d.canonical}\n` +
        `    actual    (${label}):                   ${d.actual}`
      )
    }),
    '',
    'Update the value to match packages/ui/src/tokens.css, restore the missing',
    'token, remove the stray one, or — if the divergence is deliberate — add',
    'it to AGENT_DARK_INTENTIONAL_DIVERGENCES / the *_ALLOWED_MISSING sets in',
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

  test('workspace globals.css matches ui-kit tokens.css exactly', () => {
    const workspace = read(WORKSPACE_GLOBALS)
    for (const [selector, canonical] of [
      [':root', canonicalLight],
      ['[data-theme="dark"]', canonicalDark],
    ] as const) {
      const actual = parseCanonicalTokens(ruleBody(workspace, selector))
      // Strict: same keys AND same values — no exemptions apply here, so a
      // deleted, renamed, added, or re-valued workspace token fails.
      const drift = findDrift(canonical, actual)
      expect(drift, formatDrift(`workspace globals.css ${selector}`, drift)).toEqual([])
    }
  })

  test('agent light fallbacks match the canonical light palette', () => {
    const actual = parseFallbackTokens(ruleBody(agent, '[data-boring-agent]'))
    expect(actual.size).toBeGreaterThan(15)
    // Light carries NO intentional divergences: every restated token must
    // equal the canon; omissions are limited to AGENT_LIGHT_ALLOWED_MISSING.
    const drift = findDrift(canonicalLight, actual, {
      allowedMissing: AGENT_LIGHT_ALLOWED_MISSING,
      allowUnexpected: AGENT_EXTRA_TOKENS,
    })
    expect(drift, formatDrift('agent [data-boring-agent]', drift)).toEqual([])
  })

  test('agent dark fallbacks match the canonical dark palette', () => {
    const actual = parseFallbackTokens(
      ruleBody(agent, '[data-theme="dark"] [data-boring-agent]'),
    )
    expect(actual.size).toBeGreaterThan(15)
    const drift = findDrift(canonicalDark, actual, {
      intentional: new Set(Object.keys(AGENT_DARK_INTENTIONAL_DIVERGENCES)),
      allowedMissing: AGENT_DARK_ALLOWED_MISSING,
      allowUnexpected: AGENT_EXTRA_TOKENS,
    })
    expect(
      drift,
      formatDrift('agent [data-theme="dark"] [data-boring-agent]', drift),
    ).toEqual([])
  })

  test('agent standalone dark literals match the canonical dark palette', () => {
    const actual = parseLiteralTokens(ruleBody(agent, '[data-theme="dark"]'))
    expect(actual.size).toBeGreaterThan(15)
    const drift = findDrift(canonicalDark, actual, {
      intentional: new Set(Object.keys(AGENT_DARK_INTENTIONAL_DIVERGENCES)),
      allowedMissing: AGENT_DARK_LITERAL_ALLOWED_MISSING,
      allowUnexpected: AGENT_EXTRA_TOKENS,
    })
    expect(drift, formatDrift('agent [data-theme="dark"]', drift)).toEqual([])
  })

  describe('guard self-checks (negative cases)', () => {
    // These pin the guard's own behavior: each mutation below MUST produce a
    // finding, so a future weakening of findDrift cannot silently reintroduce
    // the ~3-month undetected accent drift this file exists to prevent.
    const darkExemptions = new Set(Object.keys(AGENT_DARK_INTENTIONAL_DIVERGENCES))

    test('a deleted agent token is reported, not silently skipped', () => {
      const actual = parseFallbackTokens(
        ruleBody(agent, '[data-theme="dark"] [data-boring-agent]'),
      )
      actual.delete('accent')
      const drift = findDrift(canonicalDark, actual, {
        intentional: darkExemptions,
        allowedMissing: AGENT_DARK_ALLOWED_MISSING,
        allowUnexpected: AGENT_EXTRA_TOKENS,
      })
      expect(drift).toContainEqual({
        kind: 'missing',
        token: 'accent',
        canonical: canonicalDark.get('accent'),
      })
    })

    test('a renamed agent token surfaces as missing + unexpected', () => {
      const actual = parseLiteralTokens(ruleBody(agent, '[data-theme="dark"]'))
      const value = actual.get('accent-foreground')!
      actual.delete('accent-foreground')
      actual.set('accent-foreground-renamed', value)
      const drift = findDrift(canonicalDark, actual, {
        intentional: darkExemptions,
        allowedMissing: AGENT_DARK_LITERAL_ALLOWED_MISSING,
        allowUnexpected: AGENT_EXTRA_TOKENS,
      })
      expect(drift).toContainEqual({
        kind: 'missing',
        token: 'accent-foreground',
        canonical: canonicalDark.get('accent-foreground'),
      })
      expect(drift).toContainEqual({
        kind: 'unexpected',
        token: 'accent-foreground-renamed',
        canonical: null,
        actual: value,
      })
    })

    test('a workspace popover drift is NOT exempt (exemption is dark-agent-scoped)', () => {
      const workspace = read(WORKSPACE_GLOBALS)
      const actual = parseCanonicalTokens(ruleBody(workspace, '[data-theme="dark"]'))
      actual.set('popover', 'oklch(0.99 0.004 285.823)')
      const drift = findDrift(canonicalDark, actual)
      expect(drift).toContainEqual({
        kind: 'mismatch',
        token: 'popover',
        canonical: canonicalDark.get('popover'),
        actual: 'oklch(0.99 0.004 285.823)',
      })
    })

    test('an agent-light popover drift is NOT exempt either', () => {
      const actual = parseFallbackTokens(ruleBody(agent, '[data-boring-agent]'))
      actual.set('popover', 'oklch(0.5 0.1 65)')
      const drift = findDrift(canonicalLight, actual, {
        allowUnexpected: AGENT_EXTRA_TOKENS,
      })
      expect(drift).toContainEqual({
        kind: 'mismatch',
        token: 'popover',
        canonical: canonicalLight.get('popover'),
        actual: 'oklch(0.5 0.1 65)',
      })
    })
  })

  test('the AGENT_DARK_INTENTIONAL_DIVERGENCES allowlist stays honest', () => {
    const darkFallbacks = parseFallbackTokens(
      ruleBody(agent, '[data-theme="dark"] [data-boring-agent]'),
    )
    for (const token of Object.keys(AGENT_DARK_INTENTIONAL_DIVERGENCES)) {
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
