import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  GENERATED_PANE_DIAGNOSTIC_CODES,
  defineGeneratedPaneVocabulary,
  parseGeneratedPaneSpec,
  validateGeneratedPaneSpec,
} from "./index"

const baseSpec = {
  kind: "boring.generated-pane",
  version: 1,
  profile: "base",
  root: "main",
  elements: {
    main: { type: "Text", props: { text: "Hello" } },
  },
}

describe("validateGeneratedPaneSpec", () => {
  it("returns spec null for invalid root", () => {
    const result = validateGeneratedPaneSpec(null)
    expect(result.spec).toBeNull()
    expect(result.diagnostics.map((item) => item.code)).toContain(GENERATED_PANE_DIAGNOSTIC_CODES.invalidRoot)
  })

  it("returns spec null for invalid element graph", () => {
    const result = validateGeneratedPaneSpec({
      ...baseSpec,
      elements: { main: { type: "Text", props: { text: "Hello" }, children: ["missing"] } },
    })
    expect(result.spec).toBeNull()
    expect(result.diagnostics.map((item) => item.code)).toContain(GENERATED_PANE_DIAGNOSTIC_CODES.missingElement)
  })

  it("reports unknown components with a parsed spec", () => {
    const result = validateGeneratedPaneSpec({
      ...baseSpec,
      elements: { main: { type: "Missing", props: {} } },
    })
    expect(result.spec).not.toBeNull()
    expect(result.diagnostics.map((item) => item.code)).toContain(GENERATED_PANE_DIAGNOSTIC_CODES.unknownComponent)
  })

  it("reports invalid props with stable code", () => {
    const result = validateGeneratedPaneSpec({
      ...baseSpec,
      elements: { main: { type: "Text", props: { text: 42 } } },
    })
    expect(result.spec).not.toBeNull()
    expect(result.diagnostics.map((item) => item.code)).toContain(GENERATED_PANE_DIAGNOSTIC_CODES.invalidProps)
  })

  it("reports unsupported profile for active vocabulary mismatch", () => {
    const vocabulary = defineGeneratedPaneVocabulary({
      id: "custom",
      label: "Custom",
      components: { Text: { description: "Text", props: z.object({ text: z.string() }) } },
    })
    const result = validateGeneratedPaneSpec(baseSpec, vocabulary)
    expect(result.spec).not.toBeNull()
    expect(result.diagnostics.map((item) => item.code)).toContain(GENERATED_PANE_DIAGNOSTIC_CODES.unsupportedProfile)
  })

  it("parses profile-specific panes when caller supplies the matching vocabulary", () => {
    const vocabulary = defineGeneratedPaneVocabulary({
      id: "custom",
      label: "Custom",
      components: { Text: { description: "Text", props: z.object({ text: z.string() }) } },
    })
    const result = parseGeneratedPaneSpec({ ...baseSpec, profile: "custom" }, vocabulary)
    expect(result.spec?.profile).toBe("custom")
    expect(result.errors).toEqual([])
  })
})
