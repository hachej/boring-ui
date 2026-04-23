import type { Meta, StoryObj } from "@storybook/react"
import { ShadcnTab } from "../src/dock/ShadcnTab"

const meta: Meta = {
  title: "Workspace/Dock/TabBar",
  tags: ["autodocs"],
}

export default meta
type Story = StoryObj

function TabPreview({
  title,
  active = false,
}: {
  title: string
  active?: boolean
}) {
  const api = {
    id: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    close: () => console.log("close", title),
  }

  return (
    <div className={active ? "active-tab" : ""}>
      <ShadcnTab
        api={api as any}
        containerApi={{} as any}
        params={{}}
        tabLocation={"header" as any}
      />
    </div>
  )
}

export const MultipleTabs: Story = {
  render: () => (
    <div className="flex w-[640px] items-stretch gap-1 rounded border border-border bg-background p-1">
      <TabPreview title="README.md" active />
      <TabPreview title="src/main.ts" />
      <TabPreview title="docs/guide.md" />
      <TabPreview title="very-long-file-name-with-overflow.ts" />
    </div>
  ),
}

export const Overflow: Story = {
  render: () => (
    <div className="w-[320px] overflow-hidden rounded border border-border bg-background p-1">
      <div className="flex min-w-[820px] items-stretch gap-1">
        <TabPreview title="README.md" active />
        <TabPreview title="src/main.ts" />
        <TabPreview title="docs/guide.md" />
        <TabPreview title="feature-a.tsx" />
        <TabPreview title="feature-b.tsx" />
        <TabPreview title="very-long-file-name-with-overflow.ts" />
      </div>
    </div>
  ),
}
