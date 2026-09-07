import { describe, expect, it } from "vitest"
import { WorkspaceAttentionProvider } from "@hachej/boring-workspace"

/**
 * WorkspaceAttentionProvider was exported from the package root as a TYPE
 * only, so a plugin importing the component (rather than the props type) got
 * `undefined` at runtime — a failure TypeScript does not catch, because the
 * type and the value share a name. Pin the value export directly so a
 * regression here fails fast instead of surfacing as a blank Inbox badge in a
 * downstream plugin.
 */
describe("package root exports", () => {
  it("exports WorkspaceAttentionProvider as a component, not just a type", () => {
    expect(typeof WorkspaceAttentionProvider).toBe("function")
  })
})
