"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useDataClient } from "./data"
import { FileTreeRootsProvider } from "./file-tree/FileTreeRootsProvider"
import type { FileTreeRootConfig } from "./file-tree/FileTreeView"

const PRIMARY_ROOT: FileTreeRootConfig = {
  filesystem: "user",
  label: "Workspace",
  rootDir: ".",
  access: "readwrite",
  capabilities: {
    read: true,
    list: true,
    search: true,
    write: true,
    delete: true,
    move: true,
    mkdir: true,
  },
  searchPlaceholder: "Search workspace files...",
}

export interface FilesystemRootsBindingProps {
  requestKey: string
  children: ReactNode
}

/** Loads request-visible roots from the server and fails closed to Workspace. */
export function FilesystemRootsBinding({ requestKey, children }: FilesystemRootsBindingProps) {
  const client = useDataClient()
  const [lifecycleSequence, setLifecycleSequence] = useState(0)
  const effectiveRequestKey = `${requestKey}\n${lifecycleSequence}`
  const [resolved, setResolved] = useState<{
    requestKey: string
    client: typeof client
    roots: readonly FileTreeRootConfig[]
  } | null>(null)
  const roots = resolved?.requestKey === effectiveRequestKey && resolved.client === client
    ? resolved.roots
    : [PRIMARY_ROOT]

  useEffect(() => {
    // Cookie changes are not observable directly. Focus is a reliable browser
    // lifecycle opportunity to fail closed and revalidate server-owned roots.
    const revalidate = () => setLifecycleSequence((current) => current + 1)
    window.addEventListener("focus", revalidate)
    return () => window.removeEventListener("focus", revalidate)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let stale = false

    void client.getFilesystems(controller.signal)
      .then((filesystems) => {
        if (stale || controller.signal.aborted) return
        if (!filesystems.some((entry) => entry.filesystem === "user")) return
        setResolved({
          requestKey: effectiveRequestKey,
          client,
          roots: filesystems.map((entry) => ({
            filesystem: entry.filesystem,
            label: entry.label,
            rootDir: entry.rootDir,
            access: entry.access,
            capabilities: entry.capabilities,
            ...(entry.searchPlaceholder ? { searchPlaceholder: entry.searchPlaceholder } : {}),
          })),
        })
      })
      .catch(() => {
        if (stale || controller.signal.aborted) return
        console.error("Failed to load filesystem catalog")
      })

    return () => {
      stale = true
      controller.abort()
    }
  }, [client, effectiveRequestKey])

  return <FileTreeRootsProvider roots={roots}>{children}</FileTreeRootsProvider>
}
