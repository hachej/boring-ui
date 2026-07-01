import { createBoringMcpPlugin, type CreateBoringMcpPluginOptions } from '@hachej/boring-mcp/front'

const sourceApiEnabled = import.meta.env.VITE_BORING_MCP_ENABLED !== '0'

export const fullAppBoringMcpOptions: CreateBoringMcpPluginOptions = {
  label: 'Sources',
  enabledProviderIds: ['notion', 'airtable'],
  intro: 'Connect approved context sources through governed read-only MCP tools.',
  sourceApi: { enabled: sourceApiEnabled },
  connectionUnavailableMessage: sourceApiEnabled ? undefined : 'Sources are disabled for this deployment.',
}

export const fullAppBoringMcpPlugin = createBoringMcpPlugin(fullAppBoringMcpOptions)
