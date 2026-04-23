import type { ToolCatalog } from '../../shared/catalog'
import type { Sandbox } from '../../shared/sandbox'
import type { AgentTool, ToolResult } from '../../shared/tool'
import type { UiBridge, UiCommand } from '../../shared/ui-bridge'
import { createBashTool } from './tools/bashTool'
import { createEditTool } from './tools/editTool'
import { createReadTool } from './tools/readTool'
import { createWriteTool } from './tools/writeTool'

function makeError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function createGetUiStateTool(uiBridge: UiBridge): AgentTool {
  return {
    name: 'get_ui_state',
    description:
      'Get the current UI state, including open panels and focused resources.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute(): Promise<ToolResult> {
      try {
        const state = await uiBridge.getState()
        return {
          content: [{ type: 'text', text: JSON.stringify(state ?? {}) }],
          details: state,
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'get_ui_state failed'
        return makeError(message)
      }
    },
  }
}

function createExecUiTool(uiBridge: UiBridge): AgentTool {
  return {
    name: 'exec_ui',
    description:
      'Execute a UI command by command kind and params via the UI bridge.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        params: { type: 'object' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    async execute(input): Promise<ToolResult> {
      const kind = input.kind
      if (typeof kind !== 'string' || kind.length === 0) {
        return makeError('kind is required')
      }

      const params = input.params
      if (
        params !== undefined &&
        (typeof params !== 'object' || params === null || Array.isArray(params))
      ) {
        return makeError('params must be an object when provided')
      }

      try {
        const command: UiCommand = {
          kind,
          params: (params as Record<string, unknown> | undefined) ?? {},
        }
        const result = await uiBridge.postCommand(command)
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: result.status === 'error',
          details: result,
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'exec_ui failed'
        return makeError(message)
      }
    },
  }
}

function createExecuteIsolatedCodeTool(sandbox: Sandbox): AgentTool {
  return {
    name: 'execute_isolated_code',
    description: 'Execute code in isolated-code capable sandboxes.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        language: { type: 'string', enum: ['python', 'shell'] },
        image: { type: 'string' },
        packages: { type: 'array', items: { type: 'string' } },
        sandboxId: { type: 'string' },
        vmSize: { type: 'string', enum: ['xxs', 'xs', 's', 'm', 'l'] },
      },
      required: ['code', 'language'],
      additionalProperties: false,
    },
    async execute(input): Promise<ToolResult> {
      if (!sandbox.executeIsolatedCode) {
        return makeError('isolated-code capability is not wired for this sandbox')
      }

      const code = input.code
      const language = input.language
      if (typeof code !== 'string' || code.length === 0) {
        return makeError('code is required')
      }
      if (language !== 'python' && language !== 'shell') {
        return makeError('language must be python or shell')
      }

      try {
        const result = await sandbox.executeIsolatedCode({
          code,
          language,
          image: typeof input.image === 'string' ? input.image : undefined,
          packages: Array.isArray(input.packages)
            ? input.packages.filter(
                (value): value is string => typeof value === 'string',
              )
            : undefined,
          sandboxId:
            typeof input.sandboxId === 'string' ? input.sandboxId : undefined,
          vmSize:
            input.vmSize === 'xxs' ||
            input.vmSize === 'xs' ||
            input.vmSize === 's' ||
            input.vmSize === 'm' ||
            input.vmSize === 'l'
              ? input.vmSize
              : undefined,
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: result.exitCode !== 0,
          details: result,
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'execute_isolated_code failed'
        return makeError(message)
      }
    },
  }
}

export const standardCatalog: ToolCatalog = ({ workspace, sandbox, uiBridge }) => {
  const tools: AgentTool[] = [
    createBashTool(sandbox),
    createReadTool(workspace),
    createWriteTool(workspace),
    createEditTool(workspace),
  ]

  if (uiBridge) {
    tools.push(createGetUiStateTool(uiBridge), createExecUiTool(uiBridge))
  }

  if (sandbox.capabilities.includes('isolated-code')) {
    tools.push(createExecuteIsolatedCodeTool(sandbox))
  }

  return tools
}
