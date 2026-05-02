import { describe, expect, it } from "vitest"
import { createSamplePlugin } from "../index"

describe("createSamplePlugin", () => {
  it("declares panel and surface resolver outputs", () => {
    const plugin = createSamplePlugin()
    expect(plugin.outputs?.map((output) => output.type)).toEqual([
      "panel",
      "surface-resolver",
    ])
  })
})
