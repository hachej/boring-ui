import { describe, expect, it } from "vitest"
import { DEFAULT_TREE_IGNORE, filterIgnoredEntries } from "./search"
import type { FileEntry } from "./data/types"

describe("filesystem plugin search helpers", () => {
  it("hides heavyweight internal workspace directories by default", () => {
    const entries: FileEntry[] = [
      { name: ".worktrees", kind: "dir", path: ".worktrees" },
      { name: ".local", kind: "dir", path: ".local" },
      { name: ".boring-agent", kind: "dir", path: ".boring-agent" },
      { name: ".cache", kind: "dir", path: ".cache" },
      { name: "packages", kind: "dir", path: "packages" },
      { name: "README.md", kind: "file", path: "README.md" },
    ]

    expect(filterIgnoredEntries(entries, DEFAULT_TREE_IGNORE)).toEqual([
      { name: ".local", kind: "dir", path: ".local" },
      { name: "packages", kind: "dir", path: "packages" },
      { name: "README.md", kind: "file", path: "README.md" },
    ])
  })
})
