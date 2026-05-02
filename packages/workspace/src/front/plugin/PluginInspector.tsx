"use client"

import { useCallback, useEffect, useState } from "react"
import { useActivePanels } from "./useActivePanels"
import { useCommands } from "./useCommands"
import { useCatalogs } from "./useCatalogs"
import { usePluginErrors } from "./PluginErrorContext"

export interface PluginMeta {
  id: string
  label?: string
  systemPrompt?: string
}

export function PluginInspector({ plugins }: { plugins: PluginMeta[] }) {
  const [open, setOpen] = useState(false)
  const panels = useActivePanels()
  const commands = useCommands()
  const catalogs = useCatalogs()
  const { errors } = usePluginErrors()

  const toggle = useCallback(() => setOpen((v) => !v), [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "I") {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [toggle])

  if (!open) return null

  return (
    <div
      className="fixed bottom-2 right-2 z-[99999] max-h-[50vh] w-[360px] overflow-auto rounded-lg border border-border bg-background font-mono text-xs text-foreground shadow-2xl"
      data-testid="plugin-inspector"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <strong className="font-semibold">Plugin Inspector ({plugins.length})</strong>
        <button
          type="button"
          onClick={toggle}
          className="rounded-sm px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close plugin inspector"
        >
          ✕
        </button>
      </div>
      <div className="py-1">
        {plugins.map((p) => {
          const myPanels = panels.filter((x) => x.pluginId === p.id)
          const myCommands = commands.filter((x) => x.pluginId === p.id)
          const myCatalogs = catalogs.filter((x) => x.pluginId === p.id)
          const myErrors = errors.filter((x) => x.pluginId === p.id)
          return (
            <details key={p.id} className="px-3 py-1">
              <summary className="cursor-pointer select-none">
                {p.label ?? p.id}
                {myErrors.length > 0 && (
                  <span className="ml-1 text-destructive">({myErrors.length} errors)</span>
                )}
              </summary>
              <div className="space-y-0.5 pl-3 pt-1 leading-relaxed">
                <div>
                  panels: {myPanels.length}
                  {myPanels.length > 0 && ` (${myPanels.map((x) => x.id).join(", ")})`}
                </div>
                <div>commands: {myCommands.length}</div>
                <div>catalogs: {myCatalogs.length}</div>
                {p.systemPrompt && (
                  <details className="mt-1">
                    <summary className="cursor-pointer select-none text-muted-foreground">
                      systemPrompt
                    </summary>
                    <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap text-[11px]">
                      {p.systemPrompt.slice(0, 500)}
                      {p.systemPrompt.length > 500 && "…"}
                    </pre>
                  </details>
                )}
                {myErrors.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-destructive">
                    {myErrors.map((e, i) => (
                      <li key={i}>{e.error.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          )
        })}
        {plugins.length === 0 && (
          <div className="px-3 py-2 text-muted-foreground">No plugins registered.</div>
        )}
      </div>
    </div>
  )
}
