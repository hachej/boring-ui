import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

describe("CLI first paint", () => {
  test("uses workspace shell geometry before the app bundle loads", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8")

    expect(html).toContain('class="boot-shell"')
    expect(html).toContain('class="boot-sidebar"')
    expect(html).toContain('class="boot-transcript"')
    expect(html).toContain('class="boot-skeleton boot-composer"')
    expect(html).toContain('aria-label="Loading CLI workspace"')
    expect(html).toContain('localStorage.getItem("boring-ui-v2:preferences")')
    expect(html).toContain(':root[data-theme="light"]')
    expect(html).toContain("If loading does not finish")
  })
})
