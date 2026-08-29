import { extname } from "node:path"

const RUNTIME_ASSET_EXTENSIONS = new Set([".avif", ".gif", ".ico", ".jpg", ".jpeg", ".png", ".svg", ".webp", ".woff", ".woff2"])

/** Assets are inlined as data URLs rather than served as module source. */
export function isRuntimeAssetPath(path: string): boolean {
  return RUNTIME_ASSET_EXTENSIONS.has(extname(path).toLowerCase())
}

export function runtimeAssetContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".avif": return "image/avif"
    case ".gif": return "image/gif"
    case ".ico": return "image/x-icon"
    case ".jpg":
    case ".jpeg": return "image/jpeg"
    case ".png": return "image/png"
    case ".svg": return "image/svg+xml"
    case ".webp": return "image/webp"
    case ".woff": return "font/woff"
    case ".woff2": return "font/woff2"
    default: return "application/octet-stream"
  }
}

export function runtimeAssetModuleCode(path: string, bytes: Uint8Array): string {
  const dataUrl = `data:${runtimeAssetContentType(path)};base64,${Buffer.from(bytes).toString("base64")}`
  return `export default ${JSON.stringify(dataUrl)};`
}
