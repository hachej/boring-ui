import { describe, expect, it, vi } from "vitest"

import {
  formatComposedPromptMarkdown,
  loadAgentCapabilities,
  normalizePromptText,
  parseDescription,
  parseKnowledge,
  parseRootFileNames,
  parseSkills,
  parseTools,
  readLiveSystemPrompt,
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

  it("treats a whitespace-only prompt as absent", () => {
    expect(parseDescription({ systemPrompt: "   \n " }).systemPrompt).toBeNull()
    expect(parseDescription({ systemPrompt: "hi" }).systemPrompt).toBe("hi")
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
      systemPrompt: null, model: null, mcpServers: [], instructionFiles: [],
    })
    expect(parseDescription({ mcpServers: "nope", instructionFiles: 4 }).mcpServers).toEqual([])
  })
})

describe("parseSkills / parseTools", () => {
  it("hides policy-hidden skills and sorts by name", () => {
    expect(parseSkills({ skills: [
      { name: "b" }, { name: "a" }, { name: "hidden", invocable: false }, { name: "" }, {},
    ] }).map((s) => s.name)).toEqual(["a", "b"])
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

describe("prompt formatting", () => {
  it("flows single newlines as prose and keeps paragraph breaks", () => {
    expect(normalizePromptText("a\nb\n\nc")).toBe("a b\n\nc")
    expect(normalizePromptText("a\r\nb")).toBe("a b")
  })

  it("computes a fence longer than any fence inside the skill body", () => {
    const body = "# T\n\n`````text\nnested\n`````"
    const out = formatComposedPromptMarkdown(
      `<!-- boring-skill:start name=t digest=sha256:x -->\n${body}\n<!-- boring-skill:end name=t -->`,
    )
    expect(out).toContain("``````text")
    expect(out).not.toContain("boring-skill:start")
  })

  it("uses a four-backtick fence when the body has none", () => {
    const out = formatComposedPromptMarkdown(
      "<!-- boring-skill:start name=t digest=sha256:x -->\nplain\n<!-- boring-skill:end name=t -->",
    )
    expect(out).toContain("````text\nplain\n````")
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
      if (path.endsWith("/describe")) return { systemPrompt: "p", mcpServers: [] }
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
      "/describe": { systemPrompt: "p", model: "pinned", mcpServers: [] },
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

describe("readLiveSystemPrompt", () => {
  it("returns the fresh prompt when the re-read succeeds", async () => {
    const client = { getJson: async () => ({ systemPrompt: "fresh", mcpServers: [] }) }
    expect(await readLiveSystemPrompt(client, "a", "cached")).toBe("fresh")
  })

  it("falls back to the cached prompt on failure instead of throwing", async () => {
    const client = { getJson: async () => { throw new Error("down") } }
    expect(await readLiveSystemPrompt(client, "a", "cached")).toBe("cached")
  })

  it("falls back when the fresh description has no prompt at all", async () => {
    const client = { getJson: async () => ({ mcpServers: [] }) }
    expect(await readLiveSystemPrompt(client, "a", "cached")).toBe("cached")
  })
})
