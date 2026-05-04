"use client"

import { useCallback, useEffect, useState } from "react"
import { Button, IconButton } from "@boring/ui"
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const panels = useActivePanels()
  const commands = useCommands()
  const catalogs = useCatalogs()
  const { errors } = usePluginErrors()

  const toggle = useCallback(() => setOpen((v) => !v), [])
  const toggleSection = useCallback((key: string) => {
    setExpanded((current) => ({ ...current, [key]: !current[key] }))
  }, [])

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
        <IconButton
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={toggle}
          className="text-muted-foreground"
          aria-label="Close plugin inspector"
        >
          ✕
        </IconButton>
      </div>
      <div className="py-1">
        {plugins.map((p) => {
          const myPanels = panels.filter((x) => x.pluginId === p.id)
          const myCommands = commands.filter((x) => x.pluginId === p.id)
          const myCatalogs = catalogs.filter((x) => x.pluginId === p.id)
          const myErrors = errors.filter((x) => x.pluginId === p.id)
          const pluginOpen = expanded[p.id] ?? false
          const promptKey = `${p.id}:systemPrompt`
          const promptOpen = expanded[promptKey] ?? false
          return (
            <section key={p.id} className="px-3 py-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start px-0 py-0 font-mono text-xs"
                aria-expanded={pluginOpen}
                onClick={() => toggleSection(p.id)}
              >
                {pluginOpen ? "▾" : "▸"}
                <span>{p.label ?? p.id}</span>
                {myErrors.length > 0 && (
                  <span className="ml-1 text-destructive">({myErrors.length} errors)</span>
                )}
              </Button>
              {pluginOpen && (
                <div className="space-y-0.5 pl-3 pt-1 leading-relaxed">
                  <div>
                    panels: {myPanels.length}
                    {myPanels.length > 0 && ` (${myPanels.map((x) => x.id).join(", ")})`}
                  </div>
                  <div>commands: {myCommands.length}</div>
                  <div>catalogs: {myCatalogs.length}</div>
                  {p.systemPrompt && (
                    <section className="mt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-0 py-0 font-mono text-xs text-muted-foreground"
                        aria-expanded={promptOpen}
                        onClick={() => toggleSection(promptKey)}
                      >
                        {promptOpen ? "▾" : "▸"} systemPrompt
                      </Button>
                      {promptOpen && (
                        <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap text-[11px]">
                          {p.systemPrompt.slice(0, 500)}
                          {p.systemPrompt.length > 500 && "…"}
                        </pre>
                      )}
                    </section>
                  )}
                  {myErrors.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-destructive">
                      {myErrors.map((e, i) => (
                        <li key={i}>{e.error.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )
        })}
        {plugins.length === 0 && (
          <div className="px-3 py-2 text-muted-foreground">No plugins registered.</div>
        )}
      </div>
    </div>
  )
}
