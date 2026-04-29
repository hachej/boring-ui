import type { Meta, StoryObj } from "@storybook/react"
import { CodeEditor } from "../src/panes/code-editor/CodeEditor"

const meta: Meta<typeof CodeEditor> = {
  title: "Workspace/CodeEditor",
  component: CodeEditor,
  tags: ["autodocs"],
  args: {
    className: "h-[560px]",
    onChange: (content) => console.log("editor change", content.length),
  },
}

export default meta
type Story = StoryObj<typeof CodeEditor>

export const JavaScript: Story = {
  args: {
    language: "javascript",
    content: `function greet(name) {\n  return \`hello \${name}\`\n}\n\nconsole.log(greet("world"))\n`,
  },
}

export const Python: Story = {
  args: {
    language: "python",
    content: `def fibonacci(n: int) -> int:\n    if n < 2:\n        return n\n    return fibonacci(n - 1) + fibonacci(n - 2)\n`,
  },
}

export const JsonReadOnly: Story = {
  args: {
    language: "json",
    readOnly: true,
    content: JSON.stringify(
      {
        name: "workspace-fixture",
        version: "0.1.0",
        flags: { storybook: true, visualRegression: true },
      },
      null,
      2,
    ),
  },
}

export const LargeFile: Story = {
  render: (args) => (
    <CodeEditor
      {...args}
      language="typescript"
      content={"x".repeat(1_000_100)}
    />
  ),
}
