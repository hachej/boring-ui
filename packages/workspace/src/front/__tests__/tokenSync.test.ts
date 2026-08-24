import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * This file lives in the workspace package because the workspace package holds
 * the SHADOWING copy — the duplication is its debt to carry.
 *
 * `packages/workspace/src/globals.css` carries its OWN copy of the whole
 * `--boring-*` palette, and it is the copy that wins at runtime — it is loaded
 * after this one. That duplication is pre-existing debt, not something this
 * work introduced, and untangling it is its own change.
 *
 * What it must not do is drift. Editing the palette here and nowhere else is a
 * silent no-op on every real surface: a colour change that typechecks, builds,
 * ships, and does nothing. That is exactly what happened while calibrating the
 * destructive and attention tokens — the served page kept the old red until
 * the second copy was found.
 *
 * So the two files are asserted equal, token for token, in both themes. When
 * this fails, the fix is to apply the same edit to the other copy, not to
 * loosen the test.
 */
const TOKEN_LINE = /^\s*(--boring-[a-z0-9-]+)\s*:\s*(.+?);\s*$/

function paletteByTheme(css: string): Record<string, Record<string, string>> {
  const themes: Record<string, Record<string, string>> = {}
  // The palette blocks are `:root { … }` (light) and `[data-theme="dark"] { … }`.
  let theme: string | null = null
  let depth = 0
  for (const line of css.split("\n")) {
    if (depth === 0) {
      if (/^:root\s*\{/.test(line)) theme = "light"
      else if (/^\[data-theme="dark"\]\s*\{/.test(line)) theme = "dark"
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)
    if (depth <= 0) { theme = null; depth = 0; continue }
    const match = theme ? TOKEN_LINE.exec(line) : null
    if (!match || !theme) continue
    themes[theme] ??= {}
    themes[theme][match[1] as string] = (match[2] as string).trim()
  }
  return themes
}

describe("--boring-* palette duplication", () => {
  it("stays identical between the kit's tokens.css and the workspace copy that shadows it", async () => {
    const repoRoot = resolve(process.cwd(), "../..")
    const [kit, workspace] = await Promise.all([
      readFile(resolve(repoRoot, "packages/ui/src/tokens.css"), "utf8"),
      readFile(resolve(repoRoot, "packages/workspace/src/globals.css"), "utf8"),
    ])
    const kitPalette = paletteByTheme(kit)
    const workspacePalette = paletteByTheme(workspace)

    // Guard the parser itself: an empty read would make this test vacuous.
    expect(Object.keys(kitPalette.light ?? {}).length).toBeGreaterThan(20)
    expect(Object.keys(kitPalette.dark ?? {}).length).toBeGreaterThan(20)

    for (const theme of ["light", "dark"] as const) {
      for (const [token, value] of Object.entries(kitPalette[theme] ?? {})) {
        const other = workspacePalette[theme]?.[token]
        // Only tokens the workspace copy actually redeclares are compared; it
        // is allowed to carry fewer, never to carry a DIFFERENT value.
        if (other === undefined) continue
        expect(`${theme} ${token}: ${other}`).toBe(`${theme} ${token}: ${value}`)
      }
    }
  })
})
