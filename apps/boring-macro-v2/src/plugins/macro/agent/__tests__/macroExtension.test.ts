import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../server/config", () => ({
  loadMacroConfig: vi.fn().mockResolvedValue({
    clickhouse: null,
    authRedirectOnRoot: false,
    devAutoSession: true,
    deckRoot: "/tmp",
  }),
}))

vi.mock("../../server/services/clickhouse", () => ({
  DataService: vi.fn(),
}))

import macroExtension from "../index"

function createMockPi() {
  const registeredTools = new Map<string, any>()
  const eventHandlers = new Map<string, Function>()
  const api = {
    registerTool: vi.fn((tool: any) => registeredTools.set(tool.name, tool)),
    on: vi.fn((event: string, handler: Function) => eventHandlers.set(event, handler)),
  }
  return { api, registeredTools, eventHandlers }
}

describe("macroExtension factory", () => {
  let pi: ReturnType<typeof createMockPi>

  beforeEach(async () => {
    pi = createMockPi()
    await macroExtension(pi.api as any)
  })

  describe("tool registration", () => {
    it("registers exactly 4 tools", () => {
      expect(pi.registeredTools.size).toBe(4)
    })

    it("registers tools with correct names", () => {
      const names = [...pi.registeredTools.keys()].sort()
      expect(names).toEqual([
        "execute_sql",
        "get_series_data",
        "macro_search",
        "persist_derived_series",
      ])
    })

    it("registers resources_discover handler", () => {
      expect(pi.eventHandlers.has("resources_discover")).toBe(true)
    })
  })

  describe("resources_discover", () => {
    it("returns skillPaths and promptPaths under agent/", () => {
      const handler = pi.eventHandlers.get("resources_discover")!
      const result = handler()
      expect(result).toHaveProperty("skillPaths")
      expect(result).toHaveProperty("promptPaths")
      expect(Array.isArray(result.skillPaths)).toBe(true)
      expect(Array.isArray(result.promptPaths)).toBe(true)
    })

    it("paths end with /skills and /prompts", () => {
      const handler = pi.eventHandlers.get("resources_discover")!
      const result = handler()
      expect(result.skillPaths[0]).toMatch(/\/skills$/)
      expect(result.promptPaths[0]).toMatch(/\/prompts$/)
    })
  })

  describe("execute_sql", () => {
    let tool: any

    beforeEach(() => {
      tool = pi.registeredTools.get("execute_sql")
    })

    it("throws 'not configured' when clickhouse is null", async () => {
      await expect(tool.execute("call-id", { query: "SELECT 1" }, undefined, undefined, {}))
        .rejects.toThrow("not configured")
    })

    it("checks configuration before SQL validation", async () => {
      await expect(tool.execute("call-id", { query: "INSERT INTO foo VALUES (1)" }, undefined, undefined, {}))
        .rejects.toThrow("not configured")
    })

    it("checks configuration before multi-statement validation", async () => {
      await expect(tool.execute("call-id", { query: "SELECT 1;SELECT 2" }, undefined, undefined, {}))
        .rejects.toThrow("not configured")
    })

    it("schema has required query parameter", () => {
      expect(tool.parameters.required).toContain("query")
    })

    it("schema query description mentions read-only allowed verbs", () => {
      const desc: string = tool.parameters.properties.query.description
      expect(desc).toMatch(/SELECT|WITH|EXPLAIN/i)
    })

    it("schema has only query as a required field", () => {
      expect(tool.parameters.required).toEqual(["query"])
    })
  })

  describe("macro_search", () => {
    let tool: any

    beforeEach(() => {
      tool = pi.registeredTools.get("macro_search")
    })

    it("throws 'not configured' when clickhouse is null", async () => {
      await expect(tool.execute("call-id", { query: "inflation" }, undefined, undefined, {}))
        .rejects.toThrow("not configured")
    })

    it("schema has required query parameter", () => {
      expect(tool.parameters.required).toContain("query")
    })

    it("schema has optional limit with min 1 and max 100", () => {
      const props = tool.parameters.properties as Record<string, Record<string, unknown>>
      expect(props.limit.minimum).toBe(1)
      expect(props.limit.maximum).toBe(100)
      expect(tool.parameters.required).not.toContain("limit")
    })
  })

  describe("get_series_data", () => {
    let tool: any

    beforeEach(() => {
      tool = pi.registeredTools.get("get_series_data")
    })

    it("throws 'not configured' when clickhouse is null", async () => {
      await expect(tool.execute("call-id", { series_id: "CPIAUCSL" }, undefined, undefined, {}))
        .rejects.toThrow("not configured")
    })

    it("schema has required series_id", () => {
      expect(tool.parameters.required).toContain("series_id")
    })

    it("schema has optional from, to, limit, order parameters", () => {
      const props = tool.parameters.properties as Record<string, unknown>
      expect(props).toHaveProperty("from")
      expect(props).toHaveProperty("to")
      expect(props).toHaveProperty("limit")
      expect(props).toHaveProperty("order")
      const required: string[] = tool.parameters.required ?? []
      expect(required).not.toContain("from")
      expect(required).not.toContain("to")
      expect(required).not.toContain("limit")
      expect(required).not.toContain("order")
    })
  })

  describe("persist_derived_series", () => {
    let tool: any

    beforeEach(() => {
      tool = pi.registeredTools.get("persist_derived_series")
    })

    it("throws 'not configured' when clickhouse is null", async () => {
      await expect(tool.execute(
        "call-id",
        {
          output_id: "TEST_OUT",
          title: "Test Series",
          input_ids: ["A"],
          transform_name: "yoy",
          observations: [{ date: "2025-01-01", value: 1.0 }],
        },
        undefined,
        undefined,
        {}
      )).rejects.toThrow("not configured")
    })

    it("schema has required output_id, title, input_ids, transform_name, observations", () => {
      const required: string[] = tool.parameters.required ?? []
      expect(required).toContain("output_id")
      expect(required).toContain("title")
      expect(required).toContain("input_ids")
      expect(required).toContain("transform_name")
      expect(required).toContain("observations")
    })

    it("observations schema is an array of {date, value}", () => {
      const props = tool.parameters.properties as Record<string, Record<string, unknown>>
      const obs = props.observations
      expect(obs.type).toBe("array")
      const items = obs.items as Record<string, unknown>
      expect(items.type).toBe("object")
      const itemRequired = items.required as string[]
      expect(itemRequired).toContain("date")
      expect(itemRequired).toContain("value")
    })

    it("transform_spec is optional", () => {
      const required: string[] = tool.parameters.required ?? []
      expect(required).not.toContain("transform_spec")
      const props = tool.parameters.properties as Record<string, Record<string, unknown>>
      expect(props.transform_spec.type).toBe("object")
    })
  })
})
