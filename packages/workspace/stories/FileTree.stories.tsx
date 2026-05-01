import type { Meta, StoryObj } from "@storybook/react"
import { FileTree } from "../src/plugins/filesystemPlugin/file-tree/FileTree"
import { generateFileTreeNodes } from "./storybook-mocks"

const meta: Meta<typeof FileTree> = {
  title: "Workspace/FileTree",
  component: FileTree,
  tags: ["autodocs"],
  args: {
    onSelect: (path) => console.log("select", path),
    height: 560,
  },
}

export default meta
type Story = StoryObj<typeof FileTree>

export const Files10: Story = {
  args: {
    files: generateFileTreeNodes(10),
  },
}

export const Files100: Story = {
  args: {
    files: generateFileTreeNodes(100),
  },
}

export const Files1000: Story = {
  args: {
    files: generateFileTreeNodes(1000),
  },
}
