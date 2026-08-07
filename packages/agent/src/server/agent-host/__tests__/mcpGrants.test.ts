import { describe, expect, test } from 'vitest'
import { ErrorCode } from '../../../shared/error-codes'
import { resolveAgentMcpGrants, type McpConnectorCatalog, type McpGrant } from '../mcpGrants'

const WORKSPACE_A = 'ws-alpha'
const WORKSPACE_B = 'ws-beta'
const AGENT_RESEARCHER = 'researcher'
const AGENT_WRITER = 'writer'

function catalog(tools: Record<string, readonly string[]>): McpConnectorCatalog {
  return {
    getConnectorTools: (connectorId) => tools[connectorId],
  }
}

describe('resolveAgentMcpGrants', () => {
  test('agent with a grant gets exactly its allowed tools', () => {
    const grants: McpGrant[] = [
      {
        workspaceId: WORKSPACE_A,
        agentTypeId: AGENT_RESEARCHER,
        connectorId: 'notion',
        allowedTools: ['NOTION_SEARCH_NOTION_PAGE', 'NOTION_RETRIEVE_PAGE'],
      },
    ]

    const resolved = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_RESEARCHER,
      mcpServerRefs: ['notion'],
      grants,
    })

    expect(resolved.diagnostics).toEqual([])
    expect(resolved.connectors).toEqual([
      { connectorId: 'notion', allowedTools: ['NOTION_SEARCH_NOTION_PAGE', 'NOTION_RETRIEVE_PAGE'] },
    ])
  })

  test('agent without any grant gets nothing (default-deny)', () => {
    const resolved = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_RESEARCHER,
      mcpServerRefs: ['notion', 'airtable'],
      grants: [],
    })

    expect(resolved.connectors).toEqual([])
    expect(resolved.diagnostics).toHaveLength(2)
    expect(resolved.diagnostics.map((d) => d.code)).toEqual([
      ErrorCode.enum.AGENT_MCP_GRANT_REF_UNGRANTED,
      ErrorCode.enum.AGENT_MCP_GRANT_REF_UNGRANTED,
    ])
  })

  test('a declared mcpServerRef with no matching grant is dropped with a diagnostic, others still resolve', () => {
    const grants: McpGrant[] = [
      { workspaceId: WORKSPACE_A, agentTypeId: AGENT_RESEARCHER, connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] },
    ]

    const resolved = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_RESEARCHER,
      mcpServerRefs: ['notion', 'airtable'],
      grants,
    })

    expect(resolved.connectors).toEqual([{ connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] }])
    expect(resolved.diagnostics).toEqual([
      {
        code: ErrorCode.enum.AGENT_MCP_GRANT_REF_UNGRANTED,
        connectorId: 'airtable',
        message: expect.stringContaining('airtable'),
      },
    ])
  })

  test('tool-level filtering: a granted connector does not imply all of its tools', () => {
    const grants: McpGrant[] = [
      {
        workspaceId: WORKSPACE_A,
        agentTypeId: AGENT_RESEARCHER,
        connectorId: 'airtable',
        allowedTools: ['list_bases', 'search_records', 'admin_delete_base'],
      },
    ]
    const airtableCatalog = catalog({
      airtable: ['ping', 'list_bases', 'list_workspaces', 'list_tables_for_base', 'get_table_schema', 'search_records'],
    })

    const resolved = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_RESEARCHER,
      mcpServerRefs: ['airtable'],
      grants,
      catalog: airtableCatalog,
    })

    expect(resolved.connectors).toEqual([{ connectorId: 'airtable', allowedTools: ['list_bases', 'search_records'] }])
    expect(resolved.diagnostics).toEqual([
      {
        code: ErrorCode.enum.AGENT_MCP_GRANT_TOOL_NOT_ALLOWED,
        connectorId: 'airtable',
        tool: 'admin_delete_base',
        message: expect.stringContaining('admin_delete_base'),
      },
    ])
  })

  test('empty allowedTools on a grant means the connector is granted with no usable tools', () => {
    const grants: McpGrant[] = [
      { workspaceId: WORKSPACE_A, agentTypeId: AGENT_RESEARCHER, connectorId: 'notion', allowedTools: [] },
    ]

    const resolved = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_RESEARCHER,
      mcpServerRefs: ['notion'],
      grants,
    })

    expect(resolved.connectors).toEqual([{ connectorId: 'notion', allowedTools: [] }])
    expect(resolved.diagnostics).toEqual([])
  })

  test('two agents in one workspace cannot see each others connectors', () => {
    const grants: McpGrant[] = [
      { workspaceId: WORKSPACE_A, agentTypeId: AGENT_RESEARCHER, connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] },
      { workspaceId: WORKSPACE_A, agentTypeId: AGENT_WRITER, connectorId: 'airtable', allowedTools: ['list_bases'] },
    ]

    const researcher = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_RESEARCHER,
      mcpServerRefs: ['notion', 'airtable'],
      grants,
    })
    const writer = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_WRITER,
      mcpServerRefs: ['notion', 'airtable'],
      grants,
    })

    expect(researcher.connectors).toEqual([{ connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] }])
    expect(researcher.diagnostics.map((d) => d.connectorId)).toEqual(['airtable'])

    expect(writer.connectors).toEqual([{ connectorId: 'airtable', allowedTools: ['list_bases'] }])
    expect(writer.diagnostics.map((d) => d.connectorId)).toEqual(['notion'])
  })

  test('grants scoped to a different workspace never bleed into this workspace, even with the same agentTypeId', () => {
    const grants: McpGrant[] = [
      { workspaceId: WORKSPACE_B, agentTypeId: AGENT_RESEARCHER, connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] },
    ]

    const resolved = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_RESEARCHER,
      mcpServerRefs: ['notion'],
      grants,
    })

    expect(resolved.connectors).toEqual([])
    expect(resolved.diagnostics).toEqual([
      { code: ErrorCode.enum.AGENT_MCP_GRANT_REF_UNGRANTED, connectorId: 'notion', message: expect.any(String) },
    ])
  })

  test('no declared mcpServerRefs resolves to no connectors and no diagnostics, regardless of grants', () => {
    const grants: McpGrant[] = [
      { workspaceId: WORKSPACE_A, agentTypeId: AGENT_RESEARCHER, connectorId: 'notion', allowedTools: ['NOTION_RETRIEVE_PAGE'] },
    ]

    const resolved = resolveAgentMcpGrants({
      workspaceId: WORKSPACE_A,
      agentTypeId: AGENT_RESEARCHER,
      mcpServerRefs: [],
      grants,
    })

    expect(resolved.connectors).toEqual([])
    expect(resolved.diagnostics).toEqual([])
  })
})
