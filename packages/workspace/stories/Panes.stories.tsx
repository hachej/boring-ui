import type { Meta, StoryObj } from "@storybook/react"
import {
  CodeEditorPane as CodeEditorPaneComponent,
  DataCatalogPane as DataCatalogPaneComponent,
  EmptyPane,
  FileTreePane as FileTreePaneComponent,
  MarkdownEditorPane as MarkdownEditorPaneComponent,
} from "../src/panes"
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

export const DataCatalogPane: Story = {
  render: () => (
    <DataCatalogPaneComponent
      sources={[
        { id: "warehouse", name: "Warehouse", type: "bigquery" },
        { id: "postgres-main", name: "Postgres Main", type: "postgres" },
      ]}
    />
  ),
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
