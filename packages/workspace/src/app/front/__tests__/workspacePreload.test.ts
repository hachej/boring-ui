import { describe, expect, it } from "vitest"
import { relativizeWorkspacePath } from "../workspacePreload"

describe("relativizeWorkspacePath", () => {
  const root = "/home/ubuntu/projects/app/.worktrees/main-cli"

  it("strips the workspace root from an in-root absolute path", () => {
    expect(relativizeWorkspacePath(`${root}/secret-remember.md`, root)).toBe("secret-remember.md")
    expect(relativizeWorkspacePath(`${root}/src/front/App.tsx`, root)).toBe("src/front/App.tsx")
  })

  it("maps the workspace root itself to '.'", () => {
    expect(relativizeWorkspacePath(root, root)).toBe(".")
    expect(relativizeWorkspacePath(`${root}/`, root)).toBe(".")
  })

  it("leaves already-relative paths untouched", () => {
    expect(relativizeWorkspacePath("src/front/App.tsx", root)).toBe("src/front/App.tsx")
    expect(relativizeWorkspacePath("./README.md", root)).toBe("./README.md")
  })

  it("leaves absolute paths outside the root untouched (they legitimately 403)", () => {
    expect(relativizeWorkspacePath("/etc/passwd", root)).toBe("/etc/passwd")
    // A sibling worktree must not be mistaken for an in-root child via prefix.
    expect(relativizeWorkspacePath("/home/ubuntu/projects/app/.worktrees/main-cli-other/x.ts", root))
      .toBe("/home/ubuntu/projects/app/.worktrees/main-cli-other/x.ts")
  })

  it("tolerates a trailing slash on the root", () => {
    expect(relativizeWorkspacePath(`${root}/a.ts`, `${root}/`)).toBe("a.ts")
  })

  it("returns the input when root is missing", () => {
    expect(relativizeWorkspacePath(`${root}/a.ts`, null)).toBe(`${root}/a.ts`)
    expect(relativizeWorkspacePath(`${root}/a.ts`, undefined)).toBe(`${root}/a.ts`)
  })
})
