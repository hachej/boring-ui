"use client"

import { useEffect } from "react"
import { events, workspaceEvents } from "../../../front/events"
import { filesystemEvents } from "../shared/events"

function titleFromPath(path: string): string {
  return path.split("/").pop() ?? path
}

export function FilesystemFilePanelBinding() {
  useEffect(() => {
    const offMoved = events.on(filesystemEvents.moved, ({ from, to, ...meta }) => {
      events.emit(workspaceEvents.panelUpdate, {
        ...meta,
        match: [{ id: `file:${from}` }, { param: "path", value: from }],
        params: { path: to },
        title: titleFromPath(to),
      })
    })

    const offDeleted = events.on(filesystemEvents.deleted, ({ path, ...meta }) => {
      events.emit(workspaceEvents.panelClose, {
        ...meta,
        match: [{ id: `file:${path}` }, { param: "path", value: path }],
      })
    })

    return () => {
      offMoved()
      offDeleted()
    }
  }, [])

  return null
}
