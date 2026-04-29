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
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        width: 360,
        maxHeight: "50vh",
        overflow: "auto",
        background: "var(--background, #1a1a2e)",
        color: "var(--foreground, #e0e0e0)",
        border: "1px solid var(--border, #333)",
        borderRadius: 8,
        fontSize: 12,
        fontFamily: "monospace",
        zIndex: 99999,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
      data-testid="plugin-inspector"
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border, #333)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>Plugin Inspector ({plugins.length})</strong>
        <button type="button" onClick={toggle} style={{ cursor: "pointer", background: "none", border: "none", color: "inherit" }}>
          ✕
        </button>
      </div>
      <div style={{ padding: "4px 0" }}>
        {plugins.map((p) => {
          const myPanels = panels.filter((x) => x.pluginId === p.id)
          const myCommands = commands.filter((x) => x.pluginId === p.id)
          const myCatalogs = catalogs.filter((x) => x.pluginId === p.id)
          const myErrors = errors.filter((x) => x.pluginId === p.id)
          return (
            <details key={p.id} style={{ padding: "4px 12px" }}>
              <summary style={{ cursor: "pointer" }}>
                {p.label ?? p.id}
                {myErrors.length > 0 && <span style={{ color: "#ef4444", marginLeft: 4 }}>({myErrors.length} errors)</span>}
              </summary>
              <div style={{ paddingLeft: 12, paddingTop: 4, lineHeight: 1.6 }}>
                <div>panels: {myPanels.length}{myPanels.length > 0 && ` (${myPanels.map((x) => x.id).join(", ")})`}</div>
                <div>commands: {myCommands.length}</div>
                <div>catalogs: {myCatalogs.length}</div>
                {p.systemPrompt && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ cursor: "pointer", color: "var(--muted-foreground, #888)" }}>systemPrompt</summary>
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 120, overflow: "auto" }}>
                      {p.systemPrompt.slice(0, 500)}
                      {p.systemPrompt.length > 500 && "…"}
                    </pre>
                  </details>
                )}
                {myErrors.length > 0 && (
                  <ul style={{ color: "#ef4444", paddingLeft: 16, marginTop: 4 }}>
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
          <div style={{ padding: "8px 12px", color: "var(--muted-foreground, #888)" }}>No plugins registered.</div>
        )}
      </div>
    </div>
  )
}
