import type { Meta, StoryObj } from "@storybook/react"
import {
  CodeEditorPane as CodeEditorPaneComponent,
  EmptyPane,
  FileTreePane as FileTreePaneComponent,
  MarkdownEditorPane as MarkdownEditorPaneComponent,
} from "../src"
import {
  withMockWorkspaceApi,
  withWorkspaceProviders,
} from "./storybook-mocks"

const meta: Meta<typeof EmptyPane> = {
  title: "Workspace/Panes",
  component: EmptyPane,
  tags: ["autodocs"],
  decorators: [withMockWorkspaceApi, withWorkspaceProviders],
}

export default meta
type Story = StoryObj<typeof EmptyPane>

export const Empty: Story = {
  render: () => <EmptyPane />,
}

export const FileTreePane: Story = {
  render: () => <FileTreePaneComponent rootDir="." />,
}

export const CodeEditorPane: Story = {
  render: () => <CodeEditorPaneComponent path="src/main.ts" />,
}

export const MarkdownEditorPane: Story = {
  render: () => <MarkdownEditorPaneComponent path="README.md" />,
}
