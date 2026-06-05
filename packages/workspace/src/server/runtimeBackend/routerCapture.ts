import type { RuntimePluginHandler, RuntimePluginRouter } from "./defineRuntimeServerPlugin"

export type RuntimePluginMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "ALL"

export interface CapturedRuntimeRoute {
  method: RuntimePluginMethod
  path: string
  handler: RuntimePluginHandler
}

const METHODS: RuntimePluginMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"]

function routeKey(method: RuntimePluginMethod, path: string): string {
  return `${method} ${path}`
}

export function runtimeRouteKey(method: string, path: string): string {
  return routeKey(method.toUpperCase() as RuntimePluginMethod, path)
}

export function validateRuntimeRoutePath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("runtime route path must be a non-empty string")
  }
  if (!path.startsWith("/")) {
    throw new Error(`runtime route path must start with /: ${path}`)
  }
  if (path.includes("\\")) {
    throw new Error(`runtime route path must not contain backslashes: ${path}`)
  }
  if (path.includes("?") || path.includes("#")) {
    throw new Error(`runtime route path must not include query strings or fragments: ${path}`)
  }
  if (path.split("/").includes("..")) {
    throw new Error(`runtime route path must not contain .. segments: ${path}`)
  }
  if (path.includes(":")) {
    throw new Error(`runtime route path must be exact and must not contain params: ${path}`)
  }
  if (path.includes("*")) {
    throw new Error(`runtime route path must be exact and must not contain wildcards: ${path}`)
  }
  return path
}

export async function captureRuntimeRoutes(register: (router: RuntimePluginRouter) => void | Promise<void>): Promise<CapturedRuntimeRoute[]> {
  const routes: CapturedRuntimeRoute[] = []
  const seen = new Set<string>()

  const add = (method: RuntimePluginMethod, path: string, handler: RuntimePluginHandler) => {
    if (typeof handler !== "function") {
      throw new Error(`runtime route ${method} ${path} handler must be a function`)
    }
    const normalizedPath = validateRuntimeRoutePath(path)
    const key = routeKey(method, normalizedPath)
    if (seen.has(key)) throw new Error(`duplicate runtime route: ${key}`)
    seen.add(key)
    routes.push({ method, path: normalizedPath, handler })
  }

  const router = Object.fromEntries(
    METHODS.map((method) => [method.toLowerCase(), (path: string, handler: RuntimePluginHandler) => add(method, path, handler)]),
  ) as unknown as RuntimePluginRouter

  await register(router)
  return routes
}
