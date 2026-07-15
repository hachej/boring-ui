// @vitest-environment node

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(__dirname, "../../..")

function readPackageCss(path: string) {
  return readFileSync(resolve(root, path), "utf-8")
}

describe("dark theme CSS contract", () => {
  it("keys dark tokens and dark variants on data-theme across core, ui, workspace, and agent", () => {
    const cssFiles = [
      readPackageCss("core/src/front/theme.css"),
      readPackageCss("ui/src/styles.css"),
      readPackageCss("ui/src/tokens.css"),
      readPackageCss("workspace/src/globals.css"),
      readPackageCss("agent/src/front/styles/globals.css"),
    ]

    for (const content of cssFiles) {
      expect(content).toContain('[data-theme="dark"]')
      expect(content).not.toMatch(/(^|[\s,{])\.dark\b/)
    }
  })

  it("keeps agent subtree primary and primary-foreground fallbacks paired under data-theme dark", () => {
    const agentCss = readPackageCss("agent/src/front/styles/globals.css")
    const match = agentCss.match(
      /\[data-theme="dark"\]\s+\[data-boring-agent\]\s*{(?<block>[\s\S]*?)\n}/,
    )

    expect(match?.groups?.block).toContain(
      "--primary: var(--boring-primary, oklch(0.985 0 0));",
    )
    expect(match?.groups?.block).toContain(
      "--primary-foreground: var(--boring-primary-foreground, oklch(0.205 0.006 285.885));",
    )
  })
})
