// CANONICAL file visualizer front/index.tsx for a boring-ui runtime plugin.
// Recipe contract: the imports, surfaceResolvers shape, file fetch route, and
// workspace-id header below are supported public API. Do not grep workspace
// internals for these names unless `boring-ui-plugin test` fails. Change
// FILE_EXT and parser/rendering for your file type.

import React, { useEffect, useMemo, useState } from "react"
import { definePlugin, WORKSPACE_OPEN_PATH_SURFACE_KIND, type PaneProps } from "@hachej/boring-workspace/plugin"
import { useApiBaseUrl, useWorkspaceRequestId } from "@hachej/boring-workspace"

const MAIN_PANEL_ID = "<kebab-name>.panel"
const FILE_EXT = ".csv"

interface FilePaneParams {
  path?: string
}

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((row) => row.split(",").map((cell) => cell.trim()))
}

function FilePane({ params }: PaneProps<FilePaneParams>) {
  const path = params?.path ?? ""
  const apiBaseUrl = useApiBaseUrl()
  const workspaceId = useWorkspaceRequestId()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    const url = `${apiBaseUrl}/api/v1/files/raw?path=${encodeURIComponent(path)}`
    fetch(url, {
      credentials: "include",
      headers: workspaceId ? { "x-boring-workspace-id": workspaceId } : {},
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`)
        return response.text()
      })
      .then((body) => { if (!cancelled) setText(body) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [apiBaseUrl, path, workspaceId])

  const rows = useMemo(() => parseCsv(text), [text])
  const headers = rows[0] ?? []
  const dataRows = rows.slice(1)
  const numericValues = dataRows
    .map((row) => Number(row[1] ?? row[0]))
    .filter((value) => Number.isFinite(value))
  const max = Math.max(1, ...numericValues)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-semibold"><Label></div>
        <div className="text-xs text-muted-foreground">{path || `Open a ${FILE_EXT} file`}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>{headers.map((header, index) => <th key={index} className="border border-border px-2 py-1 text-left">{header}</th>)}</tr>
          </thead>
          <tbody>
            {dataRows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border border-border px-2 py-1">{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
        <svg className="mt-4 h-32 w-full overflow-visible" viewBox="0 0 320 120" role="img" aria-label="CSV value chart">
          {numericValues.map((value, index) => {
            const width = 280 / Math.max(1, numericValues.length)
            const height = (value / max) * 100
            return <rect key={index} x={10 + index * width} y={110 - height} width={Math.max(2, width - 2)} height={height} fill="currentColor" opacity="0.7" />
          })}
        </svg>
      </div>
    </div>
  )
}

export default definePlugin({
  id: "<kebab-name>",
  label: "<Label>",
  panels: [
    { id: MAIN_PANEL_ID, label: "<Label>", component: FilePane },
  ],
  commands: [
    { id: "<kebab-name>.open", title: "Open <Label>", panelId: MAIN_PANEL_ID },
  ],
  surfaceResolvers: [
    {
      id: "<kebab-name>.open-file",
      kind: WORKSPACE_OPEN_PATH_SURFACE_KIND,
      resolve: (request) => {
        if (request.kind !== WORKSPACE_OPEN_PATH_SURFACE_KIND) return null
        if (!request.target.endsWith(FILE_EXT)) return null
        return {
          id: `<kebab-name>:${request.target}`,
          component: MAIN_PANEL_ID,
          title: request.target.split("/").pop() ?? "<Label>",
          params: { path: request.target },
        }
      },
    },
  ],
})
