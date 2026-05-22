import { describe, expect, it } from "vitest"
import * as frontApi from "../index"

describe("removed sources adapter", () => {
  it("is not exported from the front API", () => {
    expect("createSourcesAdapter" in frontApi).toBe(false)
    expect("SourceEntry" in frontApi).toBe(false)
  })
})
