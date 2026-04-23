import type { Meta, StoryObj } from "@storybook/react"
import { DataCatalog } from "../src/components/DataCatalog"

const meta: Meta<typeof DataCatalog> = {
  title: "Workspace/DataCatalog",
  component: DataCatalog,
  tags: ["autodocs"],
}

export default meta
type Story = StoryObj<typeof DataCatalog>

export const Empty: Story = {
  args: {
    sources: [],
  },
}

export const MultipleSources: Story = {
  args: {
    sources: [
      {
        id: "postgres-main",
        name: "Postgres Main",
        type: "postgres",
        description: "Primary OLTP database",
      },
      {
        id: "warehouse",
        name: "Warehouse",
        type: "bigquery",
        description: "Analytics warehouse",
      },
      {
        id: "local-files",
        name: "Local Files",
        type: "filesystem",
        description: "Workspace CSV and parquet files",
      },
    ],
    onSelect: (sourceId) => console.log("selected source", sourceId),
  },
}
