import { describe, expect, it } from "vitest"
import { BORING_PLUGIN_IFRAME_ENTRY_MAX_LENGTH, validateBoringPluginManifest } from "../manifest"

describe("plugin-cli manifest validation", () => {
  it("rejects hosted iframe entries longer than the runtime limit", () => {
    const result = validateBoringPluginManifest({
      name: "hosted-plugin",
      boring: {
        iframePanels: [
          { id: "main", title: "Main", entry: `${"a".repeat(BORING_PLUGIN_IFRAME_ENTRY_MAX_LENGTH - ".html".length + 1)}.html` },
        ],
      },
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "SIZE_LIMIT_EXCEEDED", field: "boring.iframePanels[0].entry" }),
      ]))
    }
  })
})
