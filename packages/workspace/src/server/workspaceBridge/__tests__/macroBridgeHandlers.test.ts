import { describe, expect, test, vi } from "vitest"
import { WorkspaceBridgeErrorCode, type WorkspaceBridgeFileAssetPointer } from "../../../shared/workspace-bridge-rpc"
import { createWorkspaceBridgeRegistry, type WorkspaceBridgeCallContext } from "../registry"
import { MACRO_BRIDGE_OPS, guardMacroSqlQuery, registerMacroBridgeHandlers, type MacroBridgeDataService } from "../macroBridgeHandlers"

const actor = { actorKind: "agent" as const, performedBy: { label: "agent" }, onBehalfOf: { label: "human" } }

function context(capabilities: string[], callerClass: WorkspaceBridgeCallContext["callerClass"] = "runtime"): WorkspaceBridgeCallContext {
  return { callerClass, workspaceId: "workspace-1", sessionId: "session-1", capabilities, actor }
}

function createService(): MacroBridgeDataService {
  return {
    catalogSearch: vi.fn(async (input, ctx) => ({ rows: [{ id: "GDPC1", title: "GDP" }], input, workspaceId: ctx.workspaceId, callerClass: ctx.callerClass })),
    facetsList: vi.fn(async () => ({ facets: [{ name: "frequency", values: ["quarterly"] }] })),
    seriesMetadata: vi.fn(async (input) => ({ seriesId: input.seriesId, title: "GDP" })),
    seriesData: vi.fn(async (input) => ({ seriesId: input.seriesId, points: [["2024-01-01", 1]] })),
    seriesLineage: vi.fn(async (input) => ({ seriesId: input.seriesId, parents: [] })),
    sqlQuery: vi.fn(async (input) => ({ rows: [{ ok: true }], sql: input.sql, maxRows: input.maxRows, maxBytes: input.maxBytes, timeoutMs: input.timeoutMs })),
    transformPersist: vi.fn(async (input) => ({ transformId: input.transformId ?? "tx1", persisted: true })),
  }
}

describe("Macro WorkspaceBridge handlers", () => {
  test("registers only the required macro.v1 operations with canonical capabilities", () => {
    const registry = createWorkspaceBridgeRegistry()
    const registered = registerMacroBridgeHandlers(registry, { service: createService() })
    const ops = registry.listDefinitions().map((definition) => definition.op).sort()

    expect(ops).toEqual(Object.values(MACRO_BRIDGE_OPS).sort())
    expect(ops.some((op) => op.startsWith("workspace-files.v1."))).toBe(false)
    expect(ops).not.toContain("macro.v1.refresh")
    expect(ops).not.toContain("macro.v1.ch-query")
    expect(registered.definitions.find((definition) => definition.op === MACRO_BRIDGE_OPS.sqlQuery)).toMatchObject({
      requiredCapabilities: ["macro:sql.query"],
      auditCategory: "macro",
    })
    expect(registered.definitions.find((definition) => definition.op === MACRO_BRIDGE_OPS.transformPersist)).toMatchObject({
      idempotencyPolicy: "required",
      callerClassesAllowed: ["runtime", "server"],
    })
  })

  test("browser and runtime calls delegate to the injected data service without /api/macro routes", async () => {
    const service = createService()
    const registry = createWorkspaceBridgeRegistry()
    registerMacroBridgeHandlers(registry, { service })

    const browserResult = await registry.call(
      { op: MACRO_BRIDGE_OPS.catalogSearch, input: { query: "gdp" }, requestId: "req_catalog" },
      context(["macro:catalog.search"], "browser"),
    )
    const runtimeResult = await registry.call(
      { op: MACRO_BRIDGE_OPS.seriesData, input: { seriesId: "GDPC1" }, requestId: "req_data" },
      context(["macro:series.data"], "runtime"),
    )

    expect(browserResult).toMatchObject({ ok: true, output: { rows: [{ id: "GDPC1" }], workspaceId: "workspace-1", callerClass: "browser" } })
    expect(runtimeResult).toMatchObject({ ok: true, output: { seriesId: "GDPC1", points: [["2024-01-01", 1]] } })
    expect(service.catalogSearch).toHaveBeenCalledTimes(1)
    expect(service.seriesData).toHaveBeenCalledTimes(1)
  })

  test("guards SQL as read-only, single-statement, and capped", async () => {
    const registry = createWorkspaceBridgeRegistry()
    const service = createService()
    registerMacroBridgeHandlers(registry, { service, sqlDefaults: { maxRows: 10, maxBytes: 512, timeoutMs: 250 } })

    const ok = await registry.call(
      { op: MACRO_BRIDGE_OPS.sqlQuery, input: { sql: " select * from series; ", maxRows: 100, maxBytes: 4096, timeoutMs: 5_000 }, requestId: "req_sql" },
      context(["macro:sql.query"], "runtime"),
    )
    expect(ok).toMatchObject({ ok: true, output: { sql: "select * from series", maxRows: 10, maxBytes: 512, timeoutMs: 250 } })

    await expect(registry.call(
      { op: MACRO_BRIDGE_OPS.sqlQuery, input: { sql: "select 1; select 2" }, requestId: "req_multi" },
      context(["macro:sql.query"], "runtime"),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
    await expect(registry.call(
      { op: MACRO_BRIDGE_OPS.sqlQuery, input: { sql: "delete from series" }, requestId: "req_write" },
      context(["macro:sql.query"], "runtime"),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
  })

  test("transform.persist requires idempotency and server/runtime authority", async () => {
    const registry = createWorkspaceBridgeRegistry()
    const service = createService()
    const registered = registerMacroBridgeHandlers(registry, { service })
    const definition = registered.definitions.find((item) => item.op === MACRO_BRIDGE_OPS.transformPersist)

    expect(definition?.idempotencyPolicy).toBe("required")
    await expect(registry.call(
      { op: MACRO_BRIDGE_OPS.transformPersist, input: { transformId: "tx1" }, requestId: "req_browser" },
      context(["macro:transform.persist"], "browser"),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.CallerNotAllowed } })
    await expect(registry.call(
      { op: MACRO_BRIDGE_OPS.transformPersist, input: { transformId: "tx1" }, requestId: "req_runtime" },
      context(["macro:transform.persist"], "runtime"),
    )).resolves.toMatchObject({ ok: true, output: { transformId: "tx1", persisted: true } })
  })

  test("rejects oversized direct responses when no file-asset writer is configured", async () => {
    const registry = createWorkspaceBridgeRegistry()
    const service = createService()
    vi.mocked(service.seriesData).mockResolvedValue({ rows: ["x".repeat(2 * 1024 * 1024)] })
    registerMacroBridgeHandlers(registry, { service })

    await expect(registry.call(
      { op: MACRO_BRIDGE_OPS.seriesData, input: { seriesId: "BIG" }, requestId: "req_big" },
      context(["macro:series.data"], "runtime"),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.OutputTooLarge } })
  })

  test("returns a workspace-relative file-asset pointer for large macro output", async () => {
    const registry = createWorkspaceBridgeRegistry()
    const service = createService()
    const bigOutput = { rows: Array.from({ length: 50 }, (_, i) => ({ id: i, value: "secret-payload".repeat(20) })) }
    vi.mocked(service.seriesData).mockResolvedValue(bigOutput)
    const writes: Array<{ output: unknown; pointer: WorkspaceBridgeFileAssetPointer }> = []
    registerMacroBridgeHandlers(registry, {
      service,
      inlineOutputMaxBytes: 256,
      fileAssetWriter: {
        writeMacroOutput: async ({ output, contentType }) => {
          const pointer: WorkspaceBridgeFileAssetPointer = {
            kind: "file-asset",
            path: "generated/macro/series-data.json",
            contentType,
            byteLength: JSON.stringify(output).length,
            rawUrl: "/api/v1/files/raw?path=generated%2Fmacro%2Fseries-data.json",
          }
          writes.push({ output, pointer })
          return pointer
        },
      },
    })

    const result = await registry.call(
      { op: MACRO_BRIDGE_OPS.seriesData, input: { seriesId: "BIG" }, requestId: "req_asset" },
      context(["macro:series.data"], "runtime"),
    )

    expect(result).toMatchObject({
      ok: true,
      output: {
        kind: "file-asset",
        path: "generated/macro/series-data.json",
        contentType: "application/json",
        rawUrl: "/api/v1/files/raw?path=generated%2Fmacro%2Fseries-data.json",
      },
    })
    expect(writes).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain("secret-payload")
    expect(JSON.stringify(result)).not.toContain("/home/")
  })

  test("rejects unsafe generated file-asset paths", async () => {
    const registry = createWorkspaceBridgeRegistry()
    const service = createService()
    vi.mocked(service.seriesData).mockResolvedValue({ rows: ["x".repeat(1024)] })
    registerMacroBridgeHandlers(registry, {
      service,
      inlineOutputMaxBytes: 1,
      fileAssetWriter: { writeMacroOutput: () => ({ kind: "file-asset", path: "/home/ubuntu/leak.json", contentType: "application/json" }) },
    })
    await expect(registry.call(
      { op: MACRO_BRIDGE_OPS.seriesData, input: { seriesId: "BIG" }, requestId: "req_bad_asset" },
      context(["macro:series.data"], "runtime"),
    )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
  })

  test("SQL guard rejects raw writes before service execution", () => {
    expect(() => guardMacroSqlQuery({ sql: "update series set value = 1" })).toThrow(expect.objectContaining({ code: WorkspaceBridgeErrorCode.InvalidRequest }))
    expect(() => guardMacroSqlQuery({ query: "with x as (select 1) select * from x" })).not.toThrow()
    expect(() => guardMacroSqlQuery({ sql: "describe series_catalog" })).not.toThrow()
    expect(() => guardMacroSqlQuery({ sql: "show tables" })).not.toThrow()
  })

  test("rejects invalid file-asset raw URLs", async () => {
    for (const [name, pointer] of [
      ["non-string", { kind: "file-asset", path: "generated/macro/out.json", contentType: "application/json", rawUrl: 123 }],
      ["wrong route", { kind: "file-asset", path: "generated/macro/out.json", contentType: "application/json", rawUrl: "/api/v1/not-files/raw?path=generated%2Fmacro%2Fout.json" }],
      ["path mismatch", { kind: "file-asset", path: "generated/macro/out.json", contentType: "application/json", rawUrl: "/api/v1/files/raw?path=generated%2Fmacro%2Fother.json" }],
      ["backslash path", { kind: "file-asset", path: "generated\\macro\\out.json", contentType: "application/json", rawUrl: "/api/v1/files/raw?path=generated%5Cmacro%5Cout.json" }],
    ] as const) {
      const registry = createWorkspaceBridgeRegistry()
      const service = createService()
      vi.mocked(service.seriesData).mockResolvedValue({ rows: ["x".repeat(1024)] })
      registerMacroBridgeHandlers(registry, {
        service,
        inlineOutputMaxBytes: 1,
        fileAssetWriter: { writeMacroOutput: () => pointer as unknown as WorkspaceBridgeFileAssetPointer },
      })
      await expect(registry.call(
        { op: MACRO_BRIDGE_OPS.seriesData, input: { seriesId: "BIG" }, requestId: `req_bad_raw_url_${name}` },
        context(["macro:series.data"], "runtime"),
      )).resolves.toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
    }
  })
})
