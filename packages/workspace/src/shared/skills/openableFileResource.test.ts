import { describe, expect, it } from "vitest"

import { openableFileResource } from "./openableFileResource"

const ok = (path: string) => openableFileResource({ filesystem: "user", path })

describe("openableFileResource", () => {
  it("accepts a plain contained relative path", () => {
    expect(ok(".agents/personas/concierge/instructions.md"))
      .toEqual({ filesystem: "user", path: ".agents/personas/concierge/instructions.md" })
    expect(ok("AGENTS.md")).toEqual({ filesystem: "user", path: "AGENTS.md" })
  })

  it("rejects traversal, absolute and UNC paths", () => {
    expect(ok("../secrets.md")).toBeUndefined()
    expect(ok("a/../../b.md")).toBeUndefined()
    expect(ok("/etc/passwd")).toBeUndefined()
    expect(ok("\\\\server\\share\\x.md")).toBeUndefined()
  })

  it("rejects percent-encoded traversal that would decode past the guard", () => {
    expect(ok("%2e%2e/secrets.md")).toBeUndefined()
    expect(ok("a/%2E%2E/b.md")).toBeUndefined()
    expect(ok("a%2fb.md")).toBeUndefined()
    expect(ok("a%5cb.md")).toBeUndefined()
  })

  it("rejects scheme-prefixed values that are not paths at all", () => {
    expect(ok("file:///etc/passwd")).toBeUndefined()
    expect(ok("javascript:alert(1)")).toBeUndefined()
    expect(ok("https://example.com/x.md")).toBeUndefined()
    expect(ok("data:text/html,<script>")).toBeUndefined()
  })

  it("rejects empty and bare-dot segments", () => {
    expect(ok("a//b.md")).toBeUndefined()
    expect(ok("./a.md")).toBeUndefined()
    expect(ok("a/./b.md")).toBeUndefined()
    expect(ok("")).toBeUndefined()
  })

  it("requires a non-empty filesystem id, not just a safe path", () => {
    expect(openableFileResource({ filesystem: "", path: "AGENTS.md" })).toBeUndefined()
    expect(openableFileResource({ path: "AGENTS.md" })).toBeUndefined()
    expect(openableFileResource({ filesystem: 42, path: "AGENTS.md" })).toBeUndefined()
  })

  it("rejects absent or non-string paths rather than passing them through", () => {
    expect(openableFileResource(undefined)).toBeUndefined()
    expect(openableFileResource(null)).toBeUndefined()
    expect(openableFileResource({ filesystem: "user" })).toBeUndefined()
    expect(openableFileResource({ filesystem: "user", path: 7 })).toBeUndefined()
  })

  it("returns a narrowed resource, dropping any extra server-supplied fields", () => {
    const result = openableFileResource({ filesystem: "user", path: "a.md", role: "persona", mode: "edit" } as never)
    expect(result).toEqual({ filesystem: "user", path: "a.md" })
  })
})
