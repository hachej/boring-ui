import { describe, expect, it } from "vitest"
import * as fc from "fast-check"
import { insertPaneAfter, replaceActivePane } from "../chatPaneState"

const sessionId = fc.stringMatching(/^s[0-9a-z]{1,6}$/)
const sessionIds = fc.uniqueArray(sessionId, { maxLength: 8 })

function expectUnique(ids: string[]) {
  expect(new Set(ids).size).toBe(ids.length)
}

describe("chat pane state randomized invariants", () => {
  it("inserts panes without duplicating existing session views", () => {
    fc.assert(
      fc.property(sessionIds, fc.option(sessionId, { nil: undefined }), sessionId, (ids, afterId, nextId) => {
        const next = insertPaneAfter(ids, afterId, nextId)

        expectUnique(next)
        expect(next).toContain(nextId)
        expect(next.filter((id) => ids.includes(id))).toEqual(ids)

        if (ids.includes(nextId)) {
          expect(next).toEqual(ids)
        } else if (afterId && ids.includes(afterId)) {
          expect(next.indexOf(nextId)).toBe(next.indexOf(afterId) + 1)
        } else {
          expect(next.at(-1)).toBe(nextId)
        }
      }),
      { numRuns: 100, seed: 424242 },
    )
  })

  it("replaces only the active pane unless the session is already visible", () => {
    fc.assert(
      fc.property(sessionIds, fc.option(sessionId, { nil: undefined }), sessionId, (ids, activeId, nextId) => {
        const next = replaceActivePane(ids, activeId, nextId)

        expectUnique(next)
        expect(next).toContain(nextId)

        if (ids.includes(nextId)) {
          expect(next).toEqual(ids)
          return
        }

        if (ids.length === 0) {
          expect(next).toEqual([nextId])
          return
        }

        expect(next).toHaveLength(ids.length)
        const replaceIndex = activeId && ids.includes(activeId) ? ids.indexOf(activeId) : 0
        expect(next[replaceIndex]).toBe(nextId)
        for (const [index, id] of ids.entries()) {
          if (index !== replaceIndex) expect(next[index]).toBe(id)
        }
      }),
      { numRuns: 100, seed: 424242 },
    )
  })
})
