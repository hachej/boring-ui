import { useEffect, useState } from "react"
import type { ComponentProps } from "react"
import type { Streamdown } from "streamdown"

type StreamdownPlugins = NonNullable<ComponentProps<typeof Streamdown>["plugins"]>

let streamdownPluginsPromise: Promise<StreamdownPlugins> | undefined

function loadStreamdownPlugins(): Promise<StreamdownPlugins> {
  if (streamdownPluginsPromise) return streamdownPluginsPromise
  streamdownPluginsPromise = Promise.allSettled([
    import("@streamdown/cjk").then((module) => ["cjk", module.cjk] as const),
    import("@streamdown/code").then((module) => ["code", module.code] as const),
    import("@streamdown/math").then((module) => ["math", module.math] as const),
    import("@streamdown/mermaid").then((module) => ["mermaid", module.mermaid] as const),
  ]).then((settled) => {
    const plugins: Record<string, unknown> = {}
    for (const result of settled) {
      if (result.status === "fulfilled") plugins[result.value[0]] = result.value[1]
      else console.error("Failed to load a rich markdown renderer", result.reason)
    }
    return plugins as StreamdownPlugins
  }).catch((error) => {
    streamdownPluginsPromise = undefined
    throw error
  })
  return streamdownPluginsPromise
}

/** Load syntax, math, CJK, and diagram renderers once markdown is visible. */
export function useStreamdownPlugins(): StreamdownPlugins | undefined {
  const [plugins, setPlugins] = useState<StreamdownPlugins>()

  useEffect(() => {
    let cancelled = false
    void loadStreamdownPlugins().then((loadedPlugins) => {
      if (!cancelled) setPlugins(loadedPlugins)
    }).catch((error: unknown) => {
      console.error("Failed to load rich markdown renderers", error)
    })
    return () => { cancelled = true }
  }, [])

  return plugins
}
