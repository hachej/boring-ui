import type { ToolCatalog } from '../../shared/catalog'
import type { AgentTool } from '../../shared/tool'
import { createBashTool } from './tools/bashTool'
import { createReadTool } from './tools/readTool'
import { createWriteTool } from './tools/writeTool'
import { createEditTool } from './tools/editTool'

export const standardCatalog: ToolCatalog = ({ workspace, sandbox, uiBridge }) => {
  const tools: AgentTool[] = [
    createBashTool(sandbox),
    createReadTool(workspace),
    createWriteTool(workspace),
    createEditTool(workspace),
  ]

  if (uiBridge) {
    tools.push(
      createGetUiStateTool(uiBridge),
      createExecUiTool(uiBridge),
    )
  }

  if (sandbox.capabilities.includes('isolated-code')) {
    tools.push(createExecuteIsolatedCodeTool(sandbox))
  }

  return tools
}

function createGetUiStateTool(_bridge: object): AgentTool {
  return {
    name: 'get_ui_state',
    description: 'Get the current UI state including open panels, active file, and visible files.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      return { content: [{ type: 'text', text: '{}' }] }
    },
  }
}

function createExecUiTool(_bridge: object): AgentTool {
  return {
    name: 'exec_ui',
    description: 'Execute a UI command such as opening a file, activating a panel, or showing a notification.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['openFile', 'openPanel', 'closePanel', 'showNotification'],
          description: 'The UI command to execute.',
        },
        params: {
          type: 'object',
          description: 'Parameters for the UI command.',
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    async execute() {
      return { content: [{ type: 'text', text: 'ok' }] }
    },
  }
}

function createExecuteIsolatedCodeTool(_sandbox: object): AgentTool {
  return {
    name: 'execute_isolated_code',
    description: 'Execute code in an isolated sandbox environment.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The code to execute.' },
        language: {
          type: 'string',
          enum: ['python', 'shell'],
          description: 'The language of the code.',
        },
      },
      required: ['code', 'language'],
      additionalProperties: false,
    },
    async execute() {
      return { content: [{ type: 'text', text: 'not implemented' }], isError: true }
    },
  }
}
