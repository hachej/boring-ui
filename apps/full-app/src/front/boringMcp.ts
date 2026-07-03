import type { CreateBoringMcpPluginOptions } from '@hachej/boring-mcp/front'

const sourceApiEnabled = import.meta.env.VITE_BORING_MCP_ENABLED !== '0'

export const fullAppBoringMcpOptions: CreateBoringMcpPluginOptions = {
  label: 'MCP',
  enabledProviderIds: ['notion', 'airtable'],
  sourceApi: { enabled: sourceApiEnabled },
  connectionUnavailableMessage: sourceApiEnabled ? undefined : 'MCP is disabled for this deployment.',
}
