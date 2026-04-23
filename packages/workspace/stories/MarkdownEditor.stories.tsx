import type { Meta, StoryObj } from "@storybook/react"
import { MarkdownEditor } from "../src/components/MarkdownEditor"

const RICH_MARKDOWN = `# Workspace Notes

## Checklist
- [x] Scaffold storybook
- [x] Add responsive stories
- [ ] Review visual diffs

## Code Sample
\`\`\`ts
export function sum(a: number, b: number): number {
  return a + b
}
\`\`\`

## Quote
> Keep stories deterministic for visual testing.
`

const meta: Meta<typeof MarkdownEditor> = {
  title: "Workspace/MarkdownEditor",
  component: MarkdownEditor,
  tags: ["autodocs"],
  args: {
    className: "h-[560px]",
    onChange: (content) => console.log("markdown change", content.length),
  },
}

export default meta
type Story = StoryObj<typeof MarkdownEditor>

export const RichContent: Story = {
  args: {
    content: RICH_MARKDOWN,
  },
}

export const ToolbarStates: Story = {
  args: {
    content: `# Toolbar state fixture\n\nSelect this paragraph to test button states.\n\n- Item one\n- Item two\n\n\`\`\`ts\nconsole.log("toolbar")\n\`\`\`\n`,
  },
}

export const ReadOnly: Story = {
  args: {
    content: RICH_MARKDOWN,
    readOnly: true,
  },
}
