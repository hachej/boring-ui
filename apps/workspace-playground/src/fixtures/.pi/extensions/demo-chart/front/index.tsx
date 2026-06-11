import React from "react"
import { definePlugin } from "@hachej/boring-workspace/plugin"

function DemoChartPane() {
  return (
    <div style={{ padding: 16 }}>
      <h2>Demo Chart</h2>
      <p>Chart panel placeholder.</p>
    </div>
  )
}

export default definePlugin({
  panels: [{ id: "demo-chart.panel", label: "Demo Chart", component: DemoChartPane }],
})
