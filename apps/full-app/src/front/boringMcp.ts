import { createBoringMcpPlugin } from '@hachej/boring-mcp/front'

export const fullAppBoringMcpPlugin = createBoringMcpPlugin({
  label: 'Sources',
  enabledProviderIds: ['notion', 'airtable'],
  intro: 'Connect approved context sources through governed read-only MCP tools.',
  connectionUnavailableMessage: 'Source connection actions are not exposed in this app yet. Ask an admin to enable the boring-mcp source API endpoints.',
})
