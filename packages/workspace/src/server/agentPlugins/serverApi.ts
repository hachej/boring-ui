import type {
  BoringServerAPI,
  BoringServerRouteHandler,
  CapturedBoringServerRoute,
} from "./types"

export interface CapturingBoringServerAPIHandle extends BoringServerAPI {
  flush(): CapturedBoringServerRoute[]
}

function normalizeRoutePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) throw new Error("boring server route path must be non-empty")
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

export function createCapturingBoringServerAPI(): CapturingBoringServerAPIHandle {
  const routes: CapturedBoringServerRoute[] = []

  const add = (method: string, path: string, handler: BoringServerRouteHandler) => {
    if (typeof handler !== "function") {
      throw new Error(`boring server route ${method} ${path} requires a handler`)
    }
    routes.push({ method, path: normalizeRoutePath(path), handler })
  }

  return {
    get(path, handler) { add("GET", path, handler) },
    post(path, handler) { add("POST", path, handler) },
    put(path, handler) { add("PUT", path, handler) },
    patch(path, handler) { add("PATCH", path, handler) },
    delete(path, handler) { add("DELETE", path, handler) },
    flush() { return [...routes] },
  }
}
