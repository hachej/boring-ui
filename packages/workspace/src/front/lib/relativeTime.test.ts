import { describe, expect, it } from "vitest"

import { formatRelativeAge } from "./relativeTime"

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0)
const ago = (seconds: number) => NOW - seconds * 1000

describe("formatRelativeAge", () => {
  it("uses one vocabulary all the way up (the two forked copies capped at 52w)", () => {
    expect(formatRelativeAge(ago(30), NOW)).toBe("now")
    expect(formatRelativeAge(ago(8 * 60), NOW)).toBe("8m")
    expect(formatRelativeAge(ago(3 * 3600), NOW)).toBe("3h")
    expect(formatRelativeAge(ago(2 * 86_400), NOW)).toBe("2d")
    expect(formatRelativeAge(ago(21 * 86_400), NOW)).toBe("3w")
    expect(formatRelativeAge(ago(200 * 86_400), NOW)).toBe("6mo")
    expect(formatRelativeAge(ago(800 * 86_400), NOW)).toBe("2y")
  })

  it("accepts the shapes both call sites already had", () => {
    expect(formatRelativeAge(new Date(ago(60)), NOW)).toBe("1m")
    expect(formatRelativeAge(new Date(ago(60)).toISOString(), NOW)).toBe("1m")
  })

  it("returns null for absent or unparseable input rather than a fake age", () => {
    expect(formatRelativeAge(undefined, NOW)).toBeNull()
    expect(formatRelativeAge(null, NOW)).toBeNull()
    expect(formatRelativeAge("nope", NOW)).toBeNull()
  })

  it("never reports a negative age for a clock-skewed future timestamp", () => {
    expect(formatRelativeAge(NOW + 60_000, NOW)).toBe("now")
  })
})
