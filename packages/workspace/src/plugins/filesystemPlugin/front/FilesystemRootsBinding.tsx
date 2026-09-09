"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useDataClient } from "./data"
import { FileTreeRootsProvider } from "./file-tree/FileTreeRootsProvider"
import type { FileTreeRootConfig } from "./file-tree/FileTreePane"

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
    upload: false,
    delete: true,
    move: true,
    mkdir: true,
  },
}

export interface FilesystemRootsBindingProps {
  requestKey: string
  children: ReactNode
}

function FilesystemRootsRequest({ requestKey, children }: FilesystemRootsBindingProps) {
  const client = useDataClient()
  const [snapshot, setSnapshot] = useState<{
    requestKey: string
    roots: readonly FileTreeRootConfig[]
  }>({ requestKey, roots: [PRIMARY_ROOT] })

  useEffect(() => {
    const controller = new AbortController()

    void client.getFilesystems(controller.signal)
      .then((filesystems) => {
        if (controller.signal.aborted || !filesystems.some((entry) => entry.filesystem === "user")) return
        setSnapshot({
          requestKey,
          roots: filesystems.map((entry) => ({
            filesystem: entry.filesystem,
            label: entry.label,
            rootDir: entry.rootDir,
            access: entry.access,
            capabilities: entry.capabilities,
          })),
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) console.error("Failed to load filesystem catalog")
      })

    return () => controller.abort()
  }, [client, requestKey])

  const roots = snapshot.requestKey === requestKey ? snapshot.roots : [PRIMARY_ROOT]
  return <FileTreeRootsProvider roots={roots}>{children}</FileTreeRootsProvider>
}

/** Loads request-visible roots from the server and fails closed to Workspace. */
export function FilesystemRootsBinding({ requestKey, children }: FilesystemRootsBindingProps) {
  return <FilesystemRootsRequest requestKey={requestKey}>{children}</FilesystemRootsRequest>
}
