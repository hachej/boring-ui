import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)

let warnedJitiMissing = false

function warnJitiUnavailable(serverPath: string, reason: string): void {
  if (warnedJitiMissing) return
  warnedJitiMissing = true
  // eslint-disable-next-line no-console
  console.warn(
    `[boring-workspace] hotReload requested but jiti is unavailable (${reason}). ` +
      `Falling back to native import() for ${serverPath}; subsequent reloads will NOT pick up source changes ` +
      `because Node's module cache will return the same module. Install jiti or set hotReload: false.`,
  )
}

function jitiImport(serverPath: string): Promise<unknown> | null {
  try {
    const jitiModule = require("jiti") as {
      createJiti?: (url: string, opts?: { moduleCache?: boolean }) => { import: (path: string) => Promise<unknown> }
    }
    const create = jitiModule.createJiti
    if (!create) {
      warnJitiUnavailable(serverPath, "createJiti not exported")
      return null
    }
    return create(import.meta.url, { moduleCache: false }).import(serverPath)
  } catch (err) {
    warnJitiUnavailable(serverPath, err instanceof Error ? err.message : String(err))
    return null
  }
}

export async function importServerModule(serverPath: string, hotReload: boolean): Promise<{ default?: unknown }> {
  if (hotReload) {
    const jiti = jitiImport(serverPath)
    if (jiti) return (await jiti) as { default?: unknown }
  }
  const href = pathToFileURL(serverPath).href
  return (await import(/* @vite-ignore */ href)) as { default?: unknown }
}
