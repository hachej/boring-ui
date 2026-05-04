import { EmptyState, Kbd } from "@boring/ui"
import type { PaneProps } from "../../../front/registry/types"

interface EmptyFilePanelParams {
  path: string
}

export function EmptyFilePanel({ params }: PaneProps<EmptyFilePanelParams>) {
  const { path } = params
  const ext = path.includes(".") ? path.split(".").pop() : undefined

  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        className="border-0"
        title="No editor available"
        description={
          ext
            ? `Install or enable a plugin that handles *.${ext} files.`
            : "Install or enable a plugin that handles this file type."
        }
      >
        <Kbd>{path}</Kbd>
      </EmptyState>
    </div>
  )
}
