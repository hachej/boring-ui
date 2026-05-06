"use client"

import { useCallback, useEffect, useState } from "react"
import { Disclosure, DisclosureContent, DisclosureTrigger, EmptyState, FloatingPanel, FloatingPanelBody, FloatingPanelHeader, IconButton } from "@hachej/boring-ui"
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
  const setSectionOpen = useCallback((key: string, value: boolean) => {
    setExpanded((current) => ({ ...current, [key]: value }))
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
    <FloatingPanel
      className="fixed bottom-2 right-2 z-[99999] max-h-[50vh] w-[360px] overflow-auto font-mono text-xs"
      data-testid="plugin-inspector"
    >
      <FloatingPanelHeader className="px-1 py-0 pb-2">
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
      </FloatingPanelHeader>
      <FloatingPanelBody>
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
              <Disclosure open={pluginOpen} onOpenChange={(value) => setSectionOpen(p.id, value)}>
                <DisclosureTrigger className="h-auto w-full px-0 py-0 font-mono text-xs">
                  <span>{p.label ?? p.id}</span>
                  {myErrors.length > 0 && (
                    <span className="ml-1 text-destructive">({myErrors.length} errors)</span>
                  )}
                </DisclosureTrigger>
                <DisclosureContent className="space-y-0.5 pl-3 pt-1 leading-relaxed">
                  <div>
                    panels: {myPanels.length}
                    {myPanels.length > 0 && ` (${myPanels.map((x) => x.id).join(", ")})`}
                  </div>
                  <div>commands: {myCommands.length}</div>
                  <div>catalogs: {myCatalogs.length}</div>
                  {p.systemPrompt && (
                    <Disclosure open={promptOpen} onOpenChange={(value) => setSectionOpen(promptKey, value)}>
                      <DisclosureTrigger className="h-auto px-0 py-0 font-mono text-xs text-muted-foreground">
                        systemPrompt
                      </DisclosureTrigger>
                      <DisclosureContent>
                        <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap text-[11px]">
                          {p.systemPrompt.slice(0, 500)}
                          {p.systemPrompt.length > 500 && "…"}
                        </pre>
                      </DisclosureContent>
                    </Disclosure>
                  )}
                  {myErrors.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-destructive">
                      {myErrors.map((e, i) => (
                        <li key={i}>{e.error.message}</li>
                      ))}
                    </ul>
                  )}
                </DisclosureContent>
              </Disclosure>
            </section>
          )
        })}
        {plugins.length === 0 && (
          <EmptyState className="min-h-0 border-0 px-3 py-2" description="No plugins registered." />
        )}
      </FloatingPanelBody>
    </FloatingPanel>
  )
}
