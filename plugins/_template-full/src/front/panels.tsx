import type { PaneProps } from "@hachej/boring-workspace"
import type { SampleParams } from "../shared/types"

export const SAMPLE_PANEL_ID = "sample-panel"

export function SamplePanel({ params }: PaneProps<SampleParams>) {
  return <div>{params.id}</div>
}
