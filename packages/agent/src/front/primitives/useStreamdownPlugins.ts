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

interface StreamdownPluginSelectionOptions {
  code?: boolean
}

const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const FENCED_CODE = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\2(?=\s*(?:\n|$))/
const INLINE_CODE = /(^|[^`])`[^`\n]+`(?!`)/
const INLINE_MATH = /(^|[^\\$])\$(?!\s|\$)(?:\\.|[^\n$])+?(?<!\\)\$(?![\d$])/
const BLOCK_MATH = /(^|\n)\s*\$\$\s*\n?[\s\S]+?\n?\s*\$\$(?=\s*(?:\n|$))/
const MERMAID_FENCE = /(^|\n)(`{3,}|~{3,})mermaid(?:[^\n]*\n)[\s\S]*?\2(?=\s*(?:\n|$))/i

export function streamdownPluginNamesForSource(
  source: unknown,
  options: StreamdownPluginSelectionOptions = {},
): StreamdownPluginName[] {
  if (typeof source !== "string" || source.length === 0) return []
  const names: StreamdownPluginName[] = []
  if (CJK_SCRIPT.test(source)) names.push("cjk")
  if (options.code !== false && (FENCED_CODE.test(source) || INLINE_CODE.test(source))) names.push("code")
  if (INLINE_MATH.test(source) || BLOCK_MATH.test(source)) names.push("math")
  if (MERMAID_FENCE.test(source)) names.push("mermaid")
  return names
}

/** Load only the rich renderers required by the visible markdown source. */
export function useStreamdownPlugins(
  source: unknown,
  options: StreamdownPluginSelectionOptions = {},
): StreamdownPlugins | undefined {
  const includeCode = options.code !== false
  const names = useMemo(() => streamdownPluginNamesForSource(source, { code: includeCode }), [includeCode, source])
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
