import type { Meta, StoryObj } from "@storybook/react"
import { DockviewShell } from "../src/dock"
import { WorkspaceProvider } from "../src/WorkspaceProvider"
import type { PanelConfig } from "../src/registry"

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

const panels: PanelConfig[] = [
  {
    id: "filetree",
    title: "Files",
    component: () => <PlaceholderPanel label="Locked sidebar group" />,
    source: "app",
  },
  {
    id: "editor",
    title: "Editor",
    component: () => <PlaceholderPanel label="Center group" />,
    source: "app",
  },
  {
    id: "agent",
    title: "Agent",
    component: () => <PlaceholderPanel label="Collapsible right group" />,
    source: "app",
  },
]

const meta: Meta = {
  title: "Workspace/Dock/GroupChrome",
  tags: ["autodocs"],
}

export default meta
type Story = StoryObj

export const LockedAndCollapsible: Story = {
  render: () => (
    <WorkspaceProvider panels={panels} persistenceEnabled={false}>
      <div className="h-[640px] w-full overflow-hidden rounded border border-border">
        <DockviewShell
          layout={{
            version: "2.0",
            groups: [
              {
                id: "sidebar",
                position: "left",
                panel: "filetree",
                locked: true,
                constraints: { minWidth: 200, maxWidthViewportRatio: 0.5 },
              },
              {
                id: "center",
                position: "center",
                panel: "editor",
                dynamic: true,
                placeholder: "editor",
                constraints: { minWidth: 300 },
              },
              {
                id: "right",
                position: "right",
                panel: "agent",
                collapsible: true,
                collapsedWidth: 40,
                constraints: { minWidth: 250 },
              },
            ],
          }}
        />
      </div>
    </WorkspaceProvider>
  ),
}
