import { useEffect, useMemo, useState } from "react"
import type { ComponentProps } from "react"
import type { Streamdown } from "streamdown"

type StreamdownPlugins = NonNullable<ComponentProps<typeof Streamdown>["plugins"]>
type StreamdownPluginName = "cjk" | "code" | "math" | "mermaid"

const streamdownPluginPromises: Partial<Record<StreamdownPluginName, Promise<unknown>>> = {}

const streamdownPluginLoaders: Record<StreamdownPluginName, () => Promise<unknown>> = {
  cjk: () => import("@streamdown/cjk").then((module) => module.cjk),
  code: () => import("@streamdown/code").then((module) => module.code),
  math: () => import("@streamdown/math").then((module) => module.math),
  mermaid: () => import("@streamdown/mermaid").then((module) => module.mermaid),
}

function loadStreamdownPlugin(name: StreamdownPluginName): Promise<unknown> {
  const existing = streamdownPluginPromises[name]
  if (existing) return existing
  const promise = streamdownPluginLoaders[name]().catch((error) => {
    delete streamdownPluginPromises[name]
    throw error
  })
  streamdownPluginPromises[name] = promise
  return promise
}

export function streamdownPluginNamesForSource(source: unknown): StreamdownPluginName[] {
  if (typeof source !== "string" || source.length === 0) return []
  const names: StreamdownPluginName[] = []
  if (/[^\u0000-\u024f\u1e00-\u1eff]/u.test(source)) names.push("cjk")
  if (/`/.test(source)) names.push("code")
  if (/(^|[^\\])\$/.test(source)) names.push("math")
  if (/```mermaid(?:\s|$)/i.test(source)) names.push("mermaid")
  return names
}

/** Load only the rich renderers required by the visible markdown source. */
export function useStreamdownPlugins(source: unknown): StreamdownPlugins | undefined {
  const names = useMemo(() => streamdownPluginNamesForSource(source), [source])
  const [plugins, setPlugins] = useState<Partial<StreamdownPlugins>>({})

  useEffect(() => {
    let cancelled = false
    for (const name of names) {
      void loadStreamdownPlugin(name).then((plugin) => {
        if (cancelled) return
        setPlugins((current) => current[name] ? current : { ...current, [name]: plugin })
      }).catch((error: unknown) => {
        console.error(`Failed to load the ${name} markdown renderer`, error)
      })
    }
    return () => { cancelled = true }
  }, [names])

  return Object.keys(plugins).length > 0 ? plugins as StreamdownPlugins : undefined
}
