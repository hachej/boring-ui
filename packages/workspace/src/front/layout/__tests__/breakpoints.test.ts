import { describe, expect, it } from "vitest"
import {
  COMPACT_MAX_WIDTH,
  WIDE_MIN_WIDTH,
  WORKSPACE_BREAKPOINTS,
  isBelowWideViewport,
  isCompactViewport,
} from "../breakpoints"

describe("workspace breakpoint tokens", () => {
  it("pins the token values (aligned with Tailwind sm/lg)", () => {
    expect(COMPACT_MAX_WIDTH).toBe(640)
    expect(WIDE_MIN_WIDTH).toBe(1024)
    expect(WORKSPACE_BREAKPOINTS).toEqual({ compactMax: 640, wideMin: 1024 })
  })

  it("uses exclusive upper bounds at both boundaries", () => {
    expect(isCompactViewport(639)).toBe(true)
    expect(isCompactViewport(640)).toBe(false)
    expect(isBelowWideViewport(1023)).toBe(true)
    expect(isBelowWideViewport(1024)).toBe(false)
  })
})
