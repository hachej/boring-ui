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
const INLINE_CODE = /(^|[^`])`[^`\n]+`(?!`)/
const INLINE_MATH = /(^|[^\\$])\$(?!\s|\$)(?:\\.|[^\n$])+?(?<!\\)\$(?![\d$])/
const BLOCK_MATH = /(^|\n)\s*\$\$\s*\n?[\s\S]+?\n?\s*\$\$(?=\s*(?:\n|$))/

function hasClosedFence(source: string, language?: string): boolean {
  const lines = source.split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index]?.match(/^ {0,3}(`{3,}|~{3,})[ \t]*([^ \t`~]+)?[^\n]*$/)
    if (!opening) continue
    if (language && opening[2]?.toLowerCase() !== language) continue
    const marker = opening[1][0]
    const minimumLength = opening[1].length
    for (let closing = index + 1; closing < lines.length; closing += 1) {
      const candidate = lines[closing]?.match(/^ {0,3}(`+|~+)[ \t]*$/)?.[1]
      if (candidate?.[0] === marker && candidate.length >= minimumLength) return true
    }
  }
  return false
}

export function streamdownPluginNamesForSource(
  source: unknown,
  options: StreamdownPluginSelectionOptions = {},
): StreamdownPluginName[] {
  if (typeof source !== "string" || source.length === 0) return []
  const names: StreamdownPluginName[] = []
  if (CJK_SCRIPT.test(source)) names.push("cjk")
  if (options.code !== false && (hasClosedFence(source) || INLINE_CODE.test(source))) names.push("code")
  if (INLINE_MATH.test(source) || BLOCK_MATH.test(source)) names.push("math")
  if (hasClosedFence(source, "mermaid")) names.push("mermaid")
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

  const selectedPlugins = useMemo(() => {
    const selected: Partial<StreamdownPlugins> = {}
    for (const name of names) {
      if (plugins[name]) selected[name] = plugins[name] as never
    }
    return selected
  }, [names, plugins])

  return Object.keys(selectedPlugins).length > 0 ? selectedPlugins as StreamdownPlugins : undefined
}
