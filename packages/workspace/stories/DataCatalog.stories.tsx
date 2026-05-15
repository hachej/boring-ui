import React from "react"
import type { Meta, StoryObj } from "@storybook/react"

function ExtractedDataExplorerStory() {
  return (
    <div className="max-w-md rounded-lg border border-border bg-background p-4 text-sm text-foreground shadow-sm">
      <h2 className="mb-2 font-semibold">Data explorer moved</h2>
      <p className="text-muted-foreground">
        Data explorer and data catalog stories now belong to app/plugin packages, not
        the workspace package.
      </p>
    </div>
  )
}

const meta: Meta<typeof ExtractedDataExplorerStory> = {
  title: "Workspace/DataExplorer",
  component: ExtractedDataExplorerStory,
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj<typeof ExtractedDataExplorerStory>

export const Extracted: Story = {}
