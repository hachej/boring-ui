import { describe, expect, it } from "vitest"
import {
  AgenticMarkdownOperationError,
  createAgenticMarkdownPocSession,
} from "../agenticMarkdownPoc"

function withSession<T>(initialMarkdown: string, run: (session: ReturnType<typeof createAgenticMarkdownPocSession>) => T): T {
  const session = createAgenticMarkdownPocSession(initialMarkdown)
  try {
    return run(session)
  } finally {
    session.destroy()
  }
}

describe("agentic TipTap markdown PoC", () => {
  it("lets an agent replace the live TipTap document and export markdown", () => {
    withSession("# Draft\n\nOld intro", (session) => {
      const result = session.applyOperations([
        { type: "replaceDocument", markdown: "# Draft\n\nNew **agent** intro" },
      ])

      expect(result.applied).toBe(1)
      expect(result.markdown).toContain("# Draft")
      expect(result.markdown).toContain("New **agent** intro")
      expect(result.contentHash).toBe(session.read().contentHash)
    })
  })

  it("applies stale-checked markdown UTF-16 range edits", () => {
    withSession("# Plan\n\nReplace this sentence.\n\nKeep this.", (session) => {
      const before = session.read()
      const from = before.markdown.indexOf("Replace")
      const to = before.markdown.indexOf("\n\nKeep")

      const result = session.applyOperations([
        {
          type: "replaceRange",
          range: { kind: "markdown-utf16-offset", from, to, baseContentHash: before.contentHash },
          markdown: "Agent wrote this sentence.",
        },
      ])

      expect(result.markdown).toContain("Agent wrote this sentence.")
      expect(result.markdown).toContain("Keep this.")
      expect(result.markdown).not.toContain("Replace this sentence.")
    })
  })

  it("rejects stale range edits instead of silently applying to the wrong document", () => {
    withSession("# Plan\n\nFirst version.", (session) => {
      const before = session.read()
      session.applyOperations([{ type: "replaceDocument", markdown: "# Plan\n\nSecond version." }])

      expect(() =>
        session.applyOperations([
          {
            type: "replaceRange",
            range: {
              kind: "markdown-utf16-offset",
              from: before.markdown.indexOf("First"),
              to: before.markdown.indexOf("First") + "First".length,
              baseContentHash: before.contentHash,
            },
            markdown: "Stale",
          },
        ]),
      ).toThrowError(AgenticMarkdownOperationError)

      try {
        session.applyOperations([
          {
            type: "replaceRange",
            range: { kind: "markdown-utf16-offset", from: 0, to: 1, baseContentHash: before.contentHash },
            markdown: "x",
          },
        ])
      } catch (error) {
        expect(error).toBeInstanceOf(AgenticMarkdownOperationError)
        expect((error as AgenticMarkdownOperationError).code).toBe("stale_range")
      }
    })
  })

  it("supports selection insertion through TipTap markdown parsing", () => {
    withSession("# Notes\n\nAlpha beta", (session) => {
      session.setSelection(1)
      const result = session.applyOperations([
        { type: "insertAtSelection", markdown: "Inserted **bold** text" },
      ])

      expect(result.markdown).toContain("Inserted **bold** text")
    })
  })

  it("applies diff-style edits against the current live markdown", () => {
    withSession("# Review\n\nThis paragraph is weak.\n\nDone.", (session) => {
      const result = session.applyOperations([
        {
          type: "applyDiff",
          diffs: [
            {
              before: "This paragraph is weak.",
              delete: "weak",
              insert: "clear and agent-edited",
            },
          ],
        },
      ])

      expect(result.markdown).toContain("This paragraph is clear and agent-edited.")
      expect(result.markdown).toContain("Done.")
    })
  })

  it("rejects malformed ProseMirror ranges with stable adapter errors", () => {
    withSession("# Notes\n\nAlpha beta", (session) => {
      const before = session.read()

      expect(() =>
        session.applyOperations([
          {
            type: "replaceRange",
            range: { kind: "prosemirror-pos", from: 100_000, to: 100_001, baseDocVersion: before.docVersion },
            markdown: "Nope",
          },
        ]),
      ).toThrowError(AgenticMarkdownOperationError)
    })
  })

  it("rejects diff deletes that extend outside their matched context", () => {
    withSession("# Review\n\nabcXYZ\n\nDone.", (session) => {
      expect(() =>
        session.applyOperations([
          {
            type: "applyDiff",
            diffs: [{ before: "abc", delete: "bcX", insert: "safe" }],
          },
        ]),
      ).toThrowError(AgenticMarkdownOperationError)
    })
  })

  it("rejects non-integer offsets before JavaScript can coerce them", () => {
    withSession("# Notes\n\nAlpha beta", (session) => {
      const before = session.read()

      expect(() =>
        session.applyOperations([
          {
            type: "replaceRange",
            range: { kind: "markdown-utf16-offset", from: 1.9, to: 2.1, baseContentHash: before.contentHash },
            markdown: "Nope",
          },
        ]),
      ).toThrowError(AgenticMarkdownOperationError)
    })
  })

  it("rejects ambiguous diff contexts instead of editing the first match", () => {
    withSession("# Review\n\nRepeat me.\n\nRepeat me.", (session) => {
      expect(() =>
        session.applyOperations([
          {
            type: "applyDiff",
            diffs: [{ before: "Repeat me.", delete: "Repeat", insert: "Changed" }],
          },
        ]),
      ).toThrowError(AgenticMarkdownOperationError)
    })
  })

  it("rejects overlapping ambiguous diff contexts", () => {
    withSession("# Review\n\naaaa", (session) => {
      expect(() =>
        session.applyOperations([
          {
            type: "applyDiff",
            diffs: [{ before: "aaa", delete: "a", insert: "b" }],
          },
        ]),
      ).toThrowError(AgenticMarkdownOperationError)
    })
  })

  it("rejects ambiguous delete spans inside a unique diff context", () => {
    withSession("# Review\n\nfoo bar foo", (session) => {
      expect(() =>
        session.applyOperations([
          {
            type: "applyDiff",
            diffs: [{ before: "foo bar foo", delete: "foo", insert: "baz" }],
          },
        ]),
      ).toThrowError(AgenticMarkdownOperationError)
    })
  })

  it("rejects multi-operation batches before partial mutation", () => {
    withSession("# Review\n\nOriginal.", (session) => {
      const before = session.read()

      expect(() =>
        session.applyOperations([
          { type: "replaceDocument", markdown: "# Review\n\nChanged once." },
          { type: "replaceDocument", markdown: "# Review\n\nChanged twice." },
        ]),
      ).toThrowError(AgenticMarkdownOperationError)
      expect(session.read().markdown).toBe(before.markdown)
    })
  })
})
