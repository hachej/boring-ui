import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"

export type AgenticMarkdownRange =
  | { kind: "markdown-utf16-offset"; from: number; to: number; baseContentHash: string }
  | { kind: "prosemirror-pos"; from: number; to: number; baseDocVersion: string }

export type AgenticMarkdownOperation =
  | { type: "replaceDocument"; markdown: string }
  | { type: "replaceRange"; range: AgenticMarkdownRange; markdown: string }
  | { type: "insertAtSelection"; markdown: string }
  | { type: "applyDiff"; diffs: AgenticMarkdownDiff[] }

export interface AgenticMarkdownDiff {
  before: string
  delete: string
  insert: string
}

export interface AgenticMarkdownReadResult {
  markdown: string
  contentHash: string
  docVersion: string
}

export interface AgenticMarkdownApplyResult extends AgenticMarkdownReadResult {
  applied: number
}

export type AgenticMarkdownErrorCode =
  | "batch_not_supported"
  | "stale_range"
  | "invalid_range"
  | "diff_context_not_found"
  | "diff_context_ambiguous"
  | "diff_delete_mismatch"

export class AgenticMarkdownOperationError extends Error {
  constructor(
    readonly code: AgenticMarkdownErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "AgenticMarkdownOperationError"
  }
}

/**
 * A deliberately small TipTap-first agentic editing PoC.
 *
 * It proves the architectural invariant from the plan: an agent operation can
 * mutate the live TipTap document first, then export markdown from TipTap as
 * the saved projection. This is not the production coordinator; it is a
 * focused adapter used by tests to validate the mechanics and edge cases.
 */
export class AgenticMarkdownPocSession {
  private readonly editor: Editor
  private docVersion = 0

  constructor(initialMarkdown: string) {
    this.editor = new Editor({
      element: typeof document !== "undefined" ? document.createElement("div") : undefined,
      extensions: [
        StarterKit,
        Markdown.configure({
          markedOptions: {
            gfm: true,
            breaks: false,
            pedantic: false,
          },
        }),
      ],
      content: initialMarkdown,
      contentType: "markdown",
      onUpdate: () => {
        this.docVersion += 1
      },
    })
  }

  destroy(): void {
    this.editor.destroy()
  }

  read(): AgenticMarkdownReadResult {
    return this.snapshot()
  }

  setSelection(from: number, to = from): void {
    this.editor.commands.setTextSelection({ from, to })
  }

  applyOperations(operations: AgenticMarkdownOperation[]): AgenticMarkdownApplyResult {
    if (operations.length !== 1) {
      throw new AgenticMarkdownOperationError(
        "batch_not_supported",
        "This PoC validates one agent operation per call; production batching must preflight and apply atomically.",
      )
    }
    this.applyOperation(operations[0]!)
    return { ...this.snapshot(), applied: 1 }
  }

  private applyOperation(operation: AgenticMarkdownOperation): void {
    switch (operation.type) {
      case "replaceDocument": {
        this.setMarkdown(operation.markdown)
        return
      }
      case "replaceRange": {
        this.replaceRange(operation.range, operation.markdown)
        return
      }
      case "insertAtSelection": {
        this.editor.commands.insertContent(operation.markdown, { contentType: "markdown" })
        return
      }
      case "applyDiff": {
        this.applyDiffs(operation.diffs)
        return
      }
    }
  }

  private replaceRange(range: AgenticMarkdownRange, replacement: string): void {
    if (range.kind === "prosemirror-pos") {
      if (range.baseDocVersion !== this.currentDocVersion()) {
        throw new AgenticMarkdownOperationError(
          "stale_range",
          "ProseMirror range was based on an older document version; re-read before editing.",
        )
      }
      const maxPos = this.editor.state.doc.content.size
      if (!isValidOffset(range.from) || !isValidOffset(range.to) || range.to < range.from || range.to > maxPos) {
        throw new AgenticMarkdownOperationError(
          "invalid_range",
          "ProseMirror range is outside the current document.",
        )
      }
      this.editor.commands.insertContentAt({ from: range.from, to: range.to }, replacement, {
        contentType: "markdown",
      })
      return
    }

    const current = this.currentMarkdown()
    if (range.baseContentHash !== hashString(current)) {
      throw new AgenticMarkdownOperationError(
        "stale_range",
        "Markdown range was based on different content; re-read before editing.",
      )
    }
    if (!isValidOffset(range.from) || !isValidOffset(range.to) || range.to < range.from || range.to > current.length) {
      throw new AgenticMarkdownOperationError("invalid_range", "Markdown UTF-16 range is outside the current document.")
    }
    this.setMarkdown(`${current.slice(0, range.from)}${replacement}${current.slice(range.to)}`)
  }

  private applyDiffs(diffs: AgenticMarkdownDiff[]): void {
    let next = this.currentMarkdown()
    for (const diff of diffs) {
      const contextIndex = next.indexOf(diff.before)
      if (contextIndex < 0) {
        throw new AgenticMarkdownOperationError(
          "diff_context_not_found",
          "Could not find diff context in current markdown; re-read before editing.",
        )
      }
      if (next.indexOf(diff.before, contextIndex + 1) >= 0) {
        throw new AgenticMarkdownOperationError(
          "diff_context_ambiguous",
          "Diff context appears more than once; re-read and provide a stronger anchor.",
        )
      }
      if (diff.delete.length === 0) {
        throw new AgenticMarkdownOperationError(
          "diff_delete_mismatch",
          "Diff delete text must be non-empty; use a range or selection insert for pure insertions.",
        )
      }
      const context = next.slice(contextIndex, contextIndex + diff.before.length)
      const relativeDeleteIndex = context.indexOf(diff.delete)
      if (relativeDeleteIndex < 0 || context.indexOf(diff.delete, relativeDeleteIndex + 1) >= 0) {
        throw new AgenticMarkdownOperationError(
          "diff_delete_mismatch",
          "Diff delete text must appear exactly once inside the matched context.",
        )
      }
      const deleteIndex = contextIndex + relativeDeleteIndex
      next = `${next.slice(0, deleteIndex)}${diff.insert}${next.slice(deleteIndex + diff.delete.length)}`
    }
    this.setMarkdown(next)
  }

  private setMarkdown(markdown: string): void {
    this.editor.commands.setContent(markdown, { contentType: "markdown" })
  }

  private currentMarkdown(): string {
    return this.editor.getMarkdown()
  }

  private currentDocVersion(): string {
    return String(this.docVersion)
  }

  private snapshot(): AgenticMarkdownReadResult {
    const markdown = this.currentMarkdown()
    return {
      markdown,
      contentHash: hashString(markdown),
      docVersion: this.currentDocVersion(),
    }
  }
}

export function createAgenticMarkdownPocSession(initialMarkdown: string): AgenticMarkdownPocSession {
  return new AgenticMarkdownPocSession(initialMarkdown)
}

function isValidOffset(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
