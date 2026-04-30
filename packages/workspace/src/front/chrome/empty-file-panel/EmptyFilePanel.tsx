import type { PaneProps } from "../../registry/types"

interface EmptyFilePanelParams {
  path: string
}

export function EmptyFilePanel({ params }: PaneProps<EmptyFilePanelParams>) {
  const { path } = params
  const ext = path.includes(".") ? path.split(".").pop() : undefined

  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
      <div className="max-w-sm space-y-2">
        <h3 className="text-base font-medium text-foreground">
          No editor for <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{path}</code>
        </h3>
        <p className="text-sm">
          {ext
            ? `Install or enable a plugin that handles *.${ext} files.`
            : "Install or enable a plugin that handles this file type."}
        </p>
      </div>
    </div>
  )
}
