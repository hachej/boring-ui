import { z } from "zod"
import {
  WorkspaceBridgeErrorCode,
  createWorkspaceBridgeError,
  type BridgeActorAttribution,
  type BridgeCallerClass,
  type WorkspaceBridgeFileAssetPointer,
  type WorkspaceBridgeJsonValue,
  type WorkspaceBridgeOperationDefinition,
} from "../../shared/workspace-bridge-rpc"
import type { WorkspaceBridgeHandler, WorkspaceBridgeRegistry } from "./registry"
import { defineTrustedDomainBridgeHandler } from "./trustedDomainHandler"

export const MACRO_BRIDGE_OPS = {
  catalogSearch: "macro.v1.catalog.search",
  facetsList: "macro.v1.facets.list",
  seriesMetadata: "macro.v1.series.metadata",
  seriesData: "macro.v1.series.data",
  seriesLineage: "macro.v1.series.lineage",
  sqlQuery: "macro.v1.sql.query",
  transformPersist: "macro.v1.transform.persist",
} as const

export type MacroBridgeOp = typeof MACRO_BRIDGE_OPS[keyof typeof MACRO_BRIDGE_OPS]
export type MacroBridgeInput = Record<string, unknown>
export type MacroBridgeOutput = WorkspaceBridgeJsonValue | Record<string, unknown> | unknown[]

export interface MacroBridgeServiceContext {
  op: MacroBridgeOp
  workspaceId: string
  sessionId?: string
  callerClass: BridgeCallerClass
  actor: BridgeActorAttribution
  requestId?: string
  signal?: AbortSignal
}

export interface MacroBridgeDataService {
  catalogSearch(input: MacroBridgeInput, context: MacroBridgeServiceContext): MacroBridgeOutput | Promise<MacroBridgeOutput>
  facetsList(input: MacroBridgeInput, context: MacroBridgeServiceContext): MacroBridgeOutput | Promise<MacroBridgeOutput>
  seriesMetadata(input: MacroBridgeInput, context: MacroBridgeServiceContext): MacroBridgeOutput | Promise<MacroBridgeOutput>
  seriesData(input: MacroBridgeInput, context: MacroBridgeServiceContext): MacroBridgeOutput | Promise<MacroBridgeOutput>
  seriesLineage(input: MacroBridgeInput, context: MacroBridgeServiceContext): MacroBridgeOutput | Promise<MacroBridgeOutput>
  sqlQuery(input: MacroSqlQueryInput, context: MacroBridgeServiceContext): MacroBridgeOutput | Promise<MacroBridgeOutput>
  transformPersist(input: MacroBridgeInput, context: MacroBridgeServiceContext): MacroBridgeOutput | Promise<MacroBridgeOutput>
}

export interface MacroBridgeHandlersOptions {
  service: MacroBridgeDataService
  owner?: string
  sqlDefaults?: MacroSqlGuardDefaults
  fileAssetWriter?: MacroFileAssetWriter
  inlineOutputMaxBytes?: number
}

export interface MacroFileAssetWriter {
  writeMacroOutput(input: MacroFileAssetWriteInput): WorkspaceBridgeFileAssetPointer | Promise<WorkspaceBridgeFileAssetPointer>
}

export interface MacroFileAssetWriteInput {
  op: MacroBridgeOp
  output: MacroBridgeOutput
  context: MacroBridgeServiceContext
  contentType: "application/json"
}

export interface RegisteredMacroBridgeHandlers {
  definitions: WorkspaceBridgeOperationDefinition[]
}

export interface MacroSqlGuardDefaults {
  maxRows?: number
  maxBytes?: number
  timeoutMs?: number
}

export interface MacroSqlQueryInput extends MacroBridgeInput {
  sql?: unknown
  query?: unknown
  maxRows?: unknown
  maxBytes?: unknown
  timeoutMs?: unknown
}

const macroInputSchema = z.object({}).passthrough()
const macroOutputSchema = z.unknown()
const DEFAULT_OWNER = "macro"
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const DEFAULT_SQL_MAX_ROWS = 1_000
const DEFAULT_SQL_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_SQL_TIMEOUT_MS = 5_000
const READ_ONLY_SQL_START = /^(select|with|explain|describe|show|desc)\b/i
const WRITE_OR_ADMIN_SQL = /\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke|copy|call|execute|vacuum|analyze|attach|detach)\b/i

export function registerMacroBridgeHandlers(
  registry: WorkspaceBridgeRegistry,
  options: MacroBridgeHandlersOptions,
): RegisteredMacroBridgeHandlers {
  const owner = options.owner ?? DEFAULT_OWNER
  const registrations = [
    macroRegistration(MACRO_BRIDGE_OPS.catalogSearch, owner, ["browser", "runtime", "server"], ["macro:catalog.search"], withMacroOutputFallback(options, MACRO_BRIDGE_OPS.catalogSearch, ({ input, context, signal }) => options.service.catalogSearch(input as MacroBridgeInput, serviceContext(MACRO_BRIDGE_OPS.catalogSearch, context, signal)))),
    macroRegistration(MACRO_BRIDGE_OPS.facetsList, owner, ["browser", "runtime", "server"], ["macro:facets.list"], withMacroOutputFallback(options, MACRO_BRIDGE_OPS.facetsList, ({ input, context, signal }) => options.service.facetsList(input as MacroBridgeInput, serviceContext(MACRO_BRIDGE_OPS.facetsList, context, signal)))),
    macroRegistration(MACRO_BRIDGE_OPS.seriesMetadata, owner, ["browser", "runtime", "server"], ["macro:series.metadata"], withMacroOutputFallback(options, MACRO_BRIDGE_OPS.seriesMetadata, ({ input, context, signal }) => options.service.seriesMetadata(input as MacroBridgeInput, serviceContext(MACRO_BRIDGE_OPS.seriesMetadata, context, signal)))),
    macroRegistration(MACRO_BRIDGE_OPS.seriesData, owner, ["browser", "runtime", "server"], ["macro:series.data"], withMacroOutputFallback(options, MACRO_BRIDGE_OPS.seriesData, ({ input, context, signal }) => options.service.seriesData(input as MacroBridgeInput, serviceContext(MACRO_BRIDGE_OPS.seriesData, context, signal)))),
    macroRegistration(MACRO_BRIDGE_OPS.seriesLineage, owner, ["browser", "runtime", "server"], ["macro:series.lineage"], withMacroOutputFallback(options, MACRO_BRIDGE_OPS.seriesLineage, ({ input, context, signal }) => options.service.seriesLineage(input as MacroBridgeInput, serviceContext(MACRO_BRIDGE_OPS.seriesLineage, context, signal)))),
    macroRegistration(MACRO_BRIDGE_OPS.sqlQuery, owner, ["browser", "runtime", "server"], ["macro:sql.query"], withMacroOutputFallback(options, MACRO_BRIDGE_OPS.sqlQuery, ({ input, context, signal }) => options.service.sqlQuery(guardMacroSqlQuery(input as MacroSqlQueryInput, options.sqlDefaults), serviceContext(MACRO_BRIDGE_OPS.sqlQuery, context, signal))), { timeoutMs: options.sqlDefaults?.timeoutMs ?? DEFAULT_SQL_TIMEOUT_MS }),
    macroRegistration(MACRO_BRIDGE_OPS.transformPersist, owner, ["runtime", "server"], ["macro:transform.persist"], withMacroOutputFallback(options, MACRO_BRIDGE_OPS.transformPersist, ({ input, context, signal }) => options.service.transformPersist(input as MacroBridgeInput, serviceContext(MACRO_BRIDGE_OPS.transformPersist, context, signal))), { idempotencyPolicy: "required" }),
  ]
  for (const registration of registrations) registry.registerHandler(registration.definition, registration.handler)
  return { definitions: registrations.map((registration) => registration.definition) }
}

export function guardMacroSqlQuery(input: MacroSqlQueryInput, defaults: MacroSqlGuardDefaults = {}): MacroSqlQueryInput {
  const rawSql = typeof input.sql === "string" ? input.sql : typeof input.query === "string" ? input.query : ""
  const sql = rawSql.trim()
  if (!sql) throw invalidSql("macro.v1.sql.query requires a SQL string")
  const withoutTrailingSemicolon = sql.replace(/;\s*$/, "").trim()
  if (withoutTrailingSemicolon.includes(";")) throw invalidSql("macro.v1.sql.query rejects multi-statement SQL")
  if (!READ_ONLY_SQL_START.test(withoutTrailingSemicolon) || WRITE_OR_ADMIN_SQL.test(withoutTrailingSemicolon)) {
    throw invalidSql("macro.v1.sql.query allows read-only SQL only")
  }
  const maxRows = boundedPositiveInteger(input.maxRows, defaults.maxRows ?? DEFAULT_SQL_MAX_ROWS, defaults.maxRows ?? DEFAULT_SQL_MAX_ROWS, "maxRows")
  const maxBytes = boundedPositiveInteger(input.maxBytes, defaults.maxBytes ?? DEFAULT_SQL_MAX_BYTES, defaults.maxBytes ?? DEFAULT_SQL_MAX_BYTES, "maxBytes")
  const timeoutMs = boundedPositiveInteger(input.timeoutMs, defaults.timeoutMs ?? DEFAULT_SQL_TIMEOUT_MS, defaults.timeoutMs ?? DEFAULT_SQL_TIMEOUT_MS, "timeoutMs")
  return { ...input, sql: withoutTrailingSemicolon, maxRows, maxBytes, timeoutMs }
}

function macroRegistration(
  op: MacroBridgeOp,
  owner: string,
  callerClassesAllowed: readonly BridgeCallerClass[],
  requiredCapabilities: readonly string[],
  handler: WorkspaceBridgeHandler,
  overrides: Partial<Pick<WorkspaceBridgeOperationDefinition, "timeoutMs" | "idempotencyPolicy" | "maxOutputBytes">> = {},
) {
  return defineTrustedDomainBridgeHandler({
    op,
    version: 1,
    owner,
    callerClassesAllowed,
    requiredCapabilities,
    inputSchema: macroInputSchema,
    outputSchema: macroOutputSchema,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_SQL_TIMEOUT_MS,
    maxInputBytes: 64 * 1024,
    maxOutputBytes: overrides.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    idempotencyPolicy: overrides.idempotencyPolicy ?? "none",
    auditCategory: "macro",
    handler,
  })
}

function withMacroOutputFallback(
  options: MacroBridgeHandlersOptions,
  op: MacroBridgeOp,
  handler: WorkspaceBridgeHandler,
): WorkspaceBridgeHandler {
  return async (args) => {
    const output = await handler(args)
    const inlineMax = options.inlineOutputMaxBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    if (measureJsonBytes(output) <= inlineMax || !options.fileAssetWriter) return output
    const pointer = await options.fileAssetWriter.writeMacroOutput({
      op,
      output: output as MacroBridgeOutput,
      context: serviceContext(op, args.context, args.signal),
      contentType: "application/json",
    })
    return validateFileAssetPointer(pointer)
  }
}

function validateFileAssetPointer(pointer: WorkspaceBridgeFileAssetPointer): WorkspaceBridgeFileAssetPointer {
  if (!pointer || pointer.kind !== "file-asset" || typeof pointer.path !== "string") throw invalidFileAsset("macro file-asset writer returned an invalid pointer")
  if (pointer.path.startsWith("/") || pointer.path.split("/").includes("..")) throw invalidFileAsset("macro file-asset path must be workspace-relative")
  if (pointer.rawUrl !== undefined && (typeof pointer.rawUrl !== "string" || !pointer.rawUrl.startsWith("/api/v1/files/raw?"))) throw invalidFileAsset("macro file-asset rawUrl must use the existing raw-file route")
  return pointer
}

function serviceContext(op: MacroBridgeOp, context: Parameters<WorkspaceBridgeHandler>[0]["context"], signal?: AbortSignal): MacroBridgeServiceContext {
  return {
    op,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    callerClass: context.callerClass,
    actor: context.actor,
    requestId: context.requestId,
    signal,
  }
}

function measureJsonBytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return Number.POSITIVE_INFINITY }
}

function boundedPositiveInteger(value: unknown, fallback: number, ceiling: number, name: string): number {
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || (value as number) <= 0) throw invalidSql(`macro.v1.sql.query ${name} must be a positive integer`)
  return Math.min(value as number, ceiling)
}

function invalidSql(message: string): never {
  throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidRequest, message)
}

function invalidFileAsset(message: string): never {
  throw createWorkspaceBridgeError(WorkspaceBridgeErrorCode.InvalidRequest, message)
}
