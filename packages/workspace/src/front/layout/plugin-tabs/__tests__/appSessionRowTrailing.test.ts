import { describe, expect, it } from "vitest"

import { resolveSessionTrailingSlot } from "../appSessionRowTrailing"

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0)
const base = { working: false, workingDotShown: false, pinned: false, now: NOW }

describe("resolveSessionTrailingSlot", () => {
  it("gives an attention badge precedence over the working badge", () => {
    const badge = { kind: "question", label: "asks", tone: "info" } as never
    expect(resolveSessionTrailingSlot({ ...base, attentionBadge: badge, working: true }).badge)
      .toEqual({ kind: "attention", badge })
  })

  it("suppresses the working badge only when the dot is ACTUALLY painted", () => {
    expect(resolveSessionTrailingSlot({ ...base, working: true, workingDotShown: true }).badge).toEqual({ kind: "none" })
    expect(resolveSessionTrailingSlot({ ...base, working: true }).badge).toEqual({ kind: "working" })
  })

  it("never lets the working state vanish: no dot painted means the badge shows", () => {
    // Regression: keying off the `activeDot` PROP (which merely allows a dot)
    // rather than the painted fact hid both the dot and the badge on a
    // working, non-active row.
    const slot = resolveSessionTrailingSlot({ ...base, working: true, workingDotShown: false })
    expect(slot.badge).toEqual({ kind: "working" })
  })

  it("shows provenance even alongside a badge, since they answer different questions", () => {
    const badge = { kind: "question", label: "asks", tone: "info" } as never
    const slot = resolveSessionTrailingSlot({ ...base, attentionBadge: badge, ownerLabel: "Alpha" })
    expect(slot.badge.kind).toBe("attention")
    expect(slot.marker).toEqual({ kind: "owner", label: "Alpha" })
  })

  it("keeps the pin visible on a working, dotted row (the two predicates used to disagree)", () => {
    const slot = resolveSessionTrailingSlot({ ...base, pinned: true, working: true, workingDotShown: true })
    expect(slot.marker).toEqual({ kind: "pin" })
  })

  it("yields the pin and the age to a badge", () => {
    const working = resolveSessionTrailingSlot({ ...base, pinned: true, working: true, updatedAt: NOW })
    expect(working.badge).toEqual({ kind: "working" })
    expect(working.marker).toEqual({ kind: "none" })
  })

  it("falls through to the quiet age only when nothing else claims the slot", () => {
    const slot = resolveSessionTrailingSlot({ ...base, updatedAt: NOW - 3 * 60 * 60 * 1000 })
    expect(slot.marker).toMatchObject({ kind: "age", label: "3h" })
    expect(slot.reserveActions).toBe(false)
  })

  it("computes the age tooltip once, on the marker itself", () => {
    const slot = resolveSessionTrailingSlot({ ...base, updatedAt: NOW })
    expect(slot.marker).toMatchObject({ kind: "age", title: new Date(NOW).toLocaleString() })
  })

  it("reserves the action width only when the slot is genuinely empty", () => {
    expect(resolveSessionTrailingSlot(base).reserveActions).toBe(true)
    expect(resolveSessionTrailingSlot({ ...base, updatedAt: NOW }).reserveActions).toBe(false)
  })

  it("ignores an unparseable timestamp instead of rendering junk", () => {
    expect(resolveSessionTrailingSlot({ ...base, updatedAt: "not a date" }).marker).toEqual({ kind: "none" })
  })
})
