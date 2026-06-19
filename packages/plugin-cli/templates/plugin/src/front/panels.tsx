import type { PaneProps } from "@hachej/boring-workspace"
import type { SampleParams } from "../shared/types"

export const SAMPLE_PANEL_ID = "sample-panel"

export function SamplePanel({ params }: PaneProps<SampleParams>) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          {params.id}
        </div>
      </div>
    </div>
  )
}
