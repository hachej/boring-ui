import { definePanel, type PaneProps } from "@boring/workspace"
import type { SampleParams } from "./types"

function SamplePanel({ params }: PaneProps<SampleParams>) {
  return <div>{params.id}</div>
}

export const samplePanel = definePanel<SampleParams>({
  id: "sample-panel",
  title: "Sample",
  component: SamplePanel,
  placement: "center",
  source: "app",
})

