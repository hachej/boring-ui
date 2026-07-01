"use client"

import { useEffect } from "react"
import { events, workspaceEvents } from "../../../front/events"
import { normalizeUiFilesystem, uiFileResourceKey } from "../../../shared/types/filesystem"
import { filesystemEvents } from "../shared/events"

function titleFromPath(path: string): string {
  return path.split("/").pop() ?? path
}

export function FilesystemFilePanelBinding() {
  useEffect(() => {
    const offMoved = events.on(filesystemEvents.moved, ({ filesystem: rawFilesystem, from, to, ...meta }) => {
      const filesystem = normalizeUiFilesystem(rawFilesystem)
      events.emit(workspaceEvents.panelUpdate, {
        ...meta,
        match: [
          { id: `file:${uiFileResourceKey({ filesystem, path: from })}` },
          { params: { path: from, filesystem } },
        ],
        params: { path: to, filesystem },
        title: titleFromPath(to),
      })
    })

    const offDeleted = events.on(filesystemEvents.deleted, ({ filesystem: rawFilesystem, path, ...meta }) => {
      const filesystem = normalizeUiFilesystem(rawFilesystem)
      events.emit(workspaceEvents.panelClose, {
        ...meta,
        match: [
          { id: `file:${uiFileResourceKey({ filesystem, path })}` },
          { params: { path, filesystem } },
          { paramPrefix: "path", value: `${path}/`, params: { filesystem } },
        ],
      })
    })

    return () => {
      offMoved()
      offDeleted()
    }
  }, [])

  return null
}
