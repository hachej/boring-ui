import { describe, it, expect } from "vitest"
import { joinPath } from "../treeModel"

describe("joinPath", () => {
  it("returns the bare name at the dot root", () => {
    expect(joinPath(".", "notes.md")).toBe("notes.md")
  })

  it("returns the bare name at the empty-string root", () => {
    expect(joinPath("", "notes.md")).toBe("notes.md")
  })

  it("joins a regular relative dir with a single slash", () => {
    expect(joinPath("src", "child.ts")).toBe("src/child.ts")
  })

  it("joins a nested relative dir", () => {
    expect(joinPath("src/lib", "child.ts")).toBe("src/lib/child.ts")
  })

  // Regression: a filesystem root configured as "/" (see company_context in
  // `FileTreeRootConfig`) used to produce "//name" via naive `${dir}/${name}`
  // string interpolation — a path that never matched what the server
  // round-tripped back, so the optimistic create entry and the confirmed
  // entry never deduped by path and the row rendered twice.
  it("does not double the slash when dir is the filesystem root '/'", () => {
    expect(joinPath("/", "root-notes.md")).toBe("root-notes.md")
  })

  it("strips a trailing slash from a regular dir before joining", () => {
    expect(joinPath("src/", "child.ts")).toBe("src/child.ts")
  })
})
