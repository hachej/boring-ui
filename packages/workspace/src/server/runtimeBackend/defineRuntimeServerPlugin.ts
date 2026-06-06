export interface PluginLogger {
  debug(fields: Record<string, unknown>, message?: string): void
  debug(message: string): void
  info(fields: Record<string, unknown>, message?: string): void
  info(message: string): void
  warn(fields: Record<string, unknown>, message?: string): void
  warn(message: string): void
  error(fields: Record<string, unknown>, message?: string): void
  error(message: string): void
}

export type ReadonlyHeaders = Pick<Headers, "entries" | "forEach" | "get" | "has" | typeof Symbol.iterator>

export interface RuntimePluginContext {
  pluginId: string
  method: string
  path: string
  query: URLSearchParams
  headers: ReadonlyHeaders
  signal: AbortSignal
  body: unknown
  logger: PluginLogger
}

export type RuntimePluginHandler = (ctx: RuntimePluginContext) => unknown | Promise<unknown>

export interface RuntimePluginRouter {
  get(path: string, handler: RuntimePluginHandler): void
  post(path: string, handler: RuntimePluginHandler): void
  put(path: string, handler: RuntimePluginHandler): void
  patch(path: string, handler: RuntimePluginHandler): void
  delete(path: string, handler: RuntimePluginHandler): void
  head(path: string, handler: RuntimePluginHandler): void
  options(path: string, handler: RuntimePluginHandler): void
  all(path: string, handler: RuntimePluginHandler): void
}

export interface RuntimePluginResponse {
  kind: "response"
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

export interface RuntimeServerPlugin {
  routes(router: RuntimePluginRouter): void | Promise<void>
  dispose?(): void | Promise<void>
}

export function defineRuntimeServerPlugin(plugin: RuntimeServerPlugin): RuntimeServerPlugin {
  return plugin
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function validateRuntimeServerPlugin(value: unknown): RuntimeServerPlugin {
  if (!isPlainObject(value)) {
    throw new Error("runtime server plugin default export must be a plain object")
  }
  if ("id" in value) {
    throw new Error("runtime server plugin must not declare id; the host supplies plugin id from package metadata")
  }
  if (typeof value.routes !== "function") {
    throw new Error("runtime server plugin default export must define routes(router)")
  }
  if (value.dispose !== undefined && typeof value.dispose !== "function") {
    throw new Error("runtime server plugin dispose must be a function when provided")
  }
  return value as unknown as RuntimeServerPlugin
}

export function isRuntimePluginResponse(value: unknown): value is RuntimePluginResponse {
  return isPlainObject(value) && value.kind === "response"
}
