import type { Meta, StoryObj } from "@storybook/react"
import { DataExplorer } from "../src/front/components/DataExplorer/DataExplorer"
import {
  createMockSeriesAdapter,
  createMockTablesAdapter,
} from "../src/front/components/DataExplorer/storybookAdapters"
import type { ExplorerRow } from "../src/front/components/DataExplorer/types"

const meta: Meta<typeof DataExplorer> = {
  title: "Workspace/DataExplorer",
  component: DataExplorer,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="h-[560px] w-[340px] border border-border bg-background">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DataExplorer>

const FREQ_LABELS: Record<string, string> = {
  D: "Daily",
  W: "Weekly",
  M: "Monthly",
  Q: "Quarterly",
  SA: "Semiannual",
  A: "Annual",
}

const log = (msg: string) => (row: ExplorerRow) =>
  // eslint-disable-next-line no-console
  console.log(msg, row.id)

// ---------------------------------------------------------------------------
// Series (FRED-style) — tree mode with frequency grouping + source facet
// ---------------------------------------------------------------------------
export const Series: Story = {
  render: () => (
    <DataExplorer
      adapter={createMockSeriesAdapter()}
      groupBy="frequency"
      facets={[
        {
          key: "frequency",
          label: "Frequency",
          order: ["D", "W", "M", "Q", "SA", "A"],
          formatValue: (v) => FREQ_LABELS[v] ?? v,
        },
        {
          key: "source",
          label: "Source",
          formatValue: (v) => (v === "fred" ? "FRED" : v === "derived" ? "Derived" : v),
        },
      ]}
      onActivate={log("activate series")}
      getDragPayload={(row) => ({ mimeType: "text/series-id", value: row.id })}
      searchPlaceholder="Search series…"
      pageSize={50}
    />
  ),
}

// ---------------------------------------------------------------------------
// Tables (warehouse-style) — schemas as groups, kind facet
// ---------------------------------------------------------------------------
export const Tables: Story = {
  render: () => (
    <DataExplorer
      adapter={createMockTablesAdapter()}
      groupBy="schema"
      facets={[
        { key: "schema", label: "Schema" },
        { key: "kind", label: "Kind", order: ["TBL", "VW", "MAT", "STR"] },
      ]}
      onActivate={log("open table")}
      searchPlaceholder="Search tables…"
    />
  ),
}

// ---------------------------------------------------------------------------
// Flat — no groupBy; toolbar still has search and facet popover
// ---------------------------------------------------------------------------
export const Flat: Story = {
  render: () => (
    <DataExplorer
      adapter={createMockTablesAdapter()}
      facets={[{ key: "kind", label: "Kind", order: ["TBL", "VW", "MAT", "STR"] }]}
      onActivate={log("open")}
      searchPlaceholder="Search…"
    />
  ),
}

// ---------------------------------------------------------------------------
// Bare — minimal: no facets, no search
// ---------------------------------------------------------------------------
export const Bare: Story = {
  render: () => (
    <DataExplorer adapter={createMockTablesAdapter()} searchable={false} />
  ),
}
