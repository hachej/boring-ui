import { describe, expect, it, vi } from "vitest"

import {
  loadAgentCapabilities,
  parseDescription,
  parseKnowledge,
  parseRootFileNames,
  parseSkills,
  parseTools,
  resolveModelLabel,
  skillSourceLabel,
} from "./agentCapabilities"

describe("parseDescription", () => {
  it("keeps only well-formed instruction refs", () => {
    const parsed = parseDescription({
      instructionFiles: [
        { filesystem: "user", path: "a.md", role: "persona" },
        { filesystem: "user" },
        { path: "b.md" },
        { filesystem: 7, path: "c.md" },
        null,
      ],
    })
    expect(parsed.instructionFiles).toEqual([
      { resource: { filesystem: "user", path: "a.md" }, role: "persona" },
    ])
  })

  it("trims the model and drops non-strings", () => {
    expect(parseDescription({ model: "  m-1 " }).model).toBe("m-1")
    expect(parseDescription({ model: 5 }).model).toBeNull()
  })

  it("drops mcp servers without an id and non-string tools", () => {
    const parsed = parseDescription({
      mcpServers: [{ id: "github", tools: ["a", 3, null] }, { tools: [] }, { id: "" }],
    })
    expect(parsed.mcpServers).toEqual([{ id: "github", tools: ["a"] }])
  })

  it("survives a completely absent or hostile payload", () => {
    expect(parseDescription(undefined)).toEqual({
      model: null, mcpServers: [], instructionFiles: [],
    })
    expect(parseDescription({ mcpServers: "nope", instructionFiles: 4 }).mcpServers).toEqual([])
  })
})

describe("parseSkills / parseTools", () => {
  it("sorts by name and KEEPS non-invocable skills (parsing is not policy)", () => {
    expect(parseSkills({ skills: [
      { name: "b" }, { name: "a" }, { name: "hidden", invocable: false }, { name: "" }, {},
    ] }).map((s) => s.name)).toEqual(["a", "b", "hidden"])
  })

  it("lets the caller apply the invocable policy", () => {
    const invocable = parseSkills({ skills: [{ name: "a" }, { name: "hidden", invocable: false }] })
      .filter((skill) => skill.invocable !== false)
    expect(invocable.map((s) => s.name)).toEqual(["a"])
  })

  it("trims tool descriptions and drops empty ones", () => {
    expect(parseTools({ tools: [{ name: "t", description: "  x  " }, { name: "u", description: "  " }] }))
      .toEqual([{ name: "t", description: "x" }, { name: "u" }])
  })

  it("returns [] for non-array payloads instead of throwing", () => {
    expect(parseSkills({ skills: "no" })).toEqual([])
    expect(parseTools(null)).toEqual([])
  })
})

describe("parseSkills totality (hostile payloads must not reach React)", () => {
  it("drops a non-string description instead of passing an object to a text node", () => {
    const [skill] = parseSkills({ skills: [{ name: "x", description: { a: 1 } }] })
    expect(skill).toEqual({ name: "x" })
  })

  it("drops a non-string source instead of letting skillSourceLabel call .trim()", () => {
    const [skill] = parseSkills({ skills: [{ name: "x", source: 42 }] })
    expect(skill).toEqual({ name: "x" })
    expect(() => skillSourceLabel(skill?.source)).not.toThrow()
  })

  it("drops a malformed resource and any unknown field the server adds", () => {
    expect(parseSkills({ skills: [{ name: "x", resource: { path: 1 }, surprise: "!" }] }))
      .toEqual([{ name: "x" }])
    expect(parseSkills({ skills: [{ name: "x", resource: { filesystem: "user", path: "a.md" } }] }))
      .toEqual([{ name: "x", resource: { filesystem: "user", path: "a.md" } }])
  })

  it("survives non-object entries", () => {
    expect(parseSkills({ skills: [null, "str", 7, { name: "ok" }] })).toEqual([{ name: "ok" }])
  })

  it("trims descriptions and drops whitespace-only ones, like parseTools", () => {
    expect(parseSkills({ skills: [{ name: "a", description: "  d  " }, { name: "b", description: "   " }] }))
      .toEqual([{ name: "a", description: "d" }, { name: "b" }])
  })
})

describe("parseKnowledge / parseRootFileNames", () => {
  it("falls back to the filesystem id when the label is blank", () => {
    expect(parseKnowledge({ filesystems: [{ filesystem: "docs", label: "  " }] }))
      .toEqual([{ filesystem: "docs", label: "docs" }])
  })

  it("keeps only file entries from a tree listing", () => {
    expect(parseRootFileNames({ entries: [
      { name: "AGENTS.md", kind: "file" }, { name: ".agents", kind: "dir" }, { kind: "file" },
    ] })).toEqual(["AGENTS.md"])
    expect(parseRootFileNames({})).toEqual([])
  })
})

describe("resolveModelLabel", () => {
  it("prefers the pinned model, labeled through the catalog", () => {
    const models = { models: [{ id: "m1", label: "One" }], defaultModel: { id: "m2" } }
    expect(resolveModelLabel(models, "m1")).toBe("One")
  })

  it("falls back to the raw id when the catalog does not know it", () => {
    expect(resolveModelLabel({ models: [] }, "ghost")).toBe("ghost")
  })

  it("uses the host default when nothing is pinned, else null", () => {
    expect(resolveModelLabel({ models: [{ id: "m2", label: "Two" }], defaultModel: { id: "m2" } }, null)).toBe("Two")
    expect(resolveModelLabel({ models: [] }, null)).toBeNull()
  })
})

describe("skillSourceLabel", () => {
  it("maps internal scopes to user words and hides unknown ones", () => {
    expect(skillSourceLabel("temporary")).toBe("workspace")
    expect(skillSourceLabel("fleet")).toBe("built-in")
    expect(skillSourceLabel("shared/x")).toBe("shared")
    expect(skillSourceLabel("@scope/pkg")).toBe("package")
    expect(skillSourceLabel("mystery-enum")).toBeUndefined()
    expect(skillSourceLabel(undefined)).toBeUndefined()
  })
})

describe("loadAgentCapabilities", () => {
  const okClient = (overrides: Record<string, unknown> = {}) => ({
    getJson: vi.fn(async (path: string) => {
      for (const [key, value] of Object.entries(overrides)) {
        if (path.includes(key)) {
          if (value instanceof Error) throw value
          return value
        }
      }
      if (path.endsWith("/describe")) return { mcpServers: [] }
      if (path.endsWith("/skills")) return { skills: [{ name: "s" }] }
      if (path.endsWith("/tools")) return { tools: [{ name: "t" }] }
      if (path.endsWith("/models")) return { models: [] }
      if (path.startsWith("/api/v1/filesystems")) return { filesystems: [] }
      return { entries: [] }
    }),
  })

  it("commits one ready status with per-request error flags", async () => {
    const client = okClient({ "/skills": new Error("boom") })
    const result = await loadAgentCapabilities(client, "a")
    expect(result.status).toBe("ready")
    expect(result.skills).toEqual({ error: true, value: [] })
    expect(result.tools).toEqual({ error: false, value: [{ name: "t" }] })
    expect(result.describeError).toBe(false)
  })

  it("still resolves the pinned model when the models catalog fails", async () => {
    const client = okClient({
      "/describe": { model: "pinned", mcpServers: [] },
      "/models": new Error("nope"),
    })
    expect((await loadAgentCapabilities(client, "a")).modelLabel).toBe("pinned")
  })

  it("encodes the agent id into every per-agent path", async () => {
    const client = okClient()
    await loadAgentCapabilities(client, "a/b")
    for (const call of client.getJson.mock.calls) {
      expect(call[0]).not.toContain("agents/a/b")
    }
    expect(client.getJson.mock.calls.some(([p]) => (p as string).includes("agents/a%2Fb/describe"))).toBe(true)
  })

  it("asks for exactly six payloads — no per-agent tree probing", async () => {
    const client = okClient()
    await loadAgentCapabilities(client, "a")
    expect(client.getJson.mock.calls).toHaveLength(6)
    expect(client.getJson.mock.calls.filter(([p]) => (p as string).startsWith("/api/v1/tree"))).toHaveLength(1)
  })
})
