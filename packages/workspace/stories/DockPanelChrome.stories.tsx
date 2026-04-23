import { DatabaseIcon } from "lucide-react"
import type { Meta, StoryObj } from "@storybook/react"
import type { DockviewPanelApi } from "dockview-react"
import { PanelChrome } from "../src/dock/PanelChrome"

function createPanelApi(id: string, title: string): DockviewPanelApi {
  return {
    id,
    title,
    close: () => console.log("close", id),
    setTitle: (nextTitle: string) => console.log("setTitle", nextTitle),
    setActive: () => console.log("setActive", id),
    isActive: true,
  } as unknown as DockviewPanelApi
}

const meta: Meta<typeof PanelChrome> = {
  title: "Workspace/Dock/PanelChrome",
  component: PanelChrome,
  tags: ["autodocs"],
  args: {
    title: "Data Sources",
    children: (
      <div className="p-4 text-sm text-muted-foreground">
        Panel content goes here.
      </div>
    ),
  },
}

export default meta
type Story = StoryObj<typeof PanelChrome>

export const WithIconAndClose: Story = {
  args: {
    icon: DatabaseIcon,
    panelApi: createPanelApi("data-catalog", "Data Sources"),
  },
}

export const EssentialWithoutClose: Story = {
  args: {
    title: "Explorer",
    essential: true,
    panelApi: createPanelApi("explorer", "Explorer"),
  },
}

export const DirtyState: Story = {
  args: {
    title: "README.md ●",
    panelApi: createPanelApi("markdown", "README.md ●"),
  },
}
