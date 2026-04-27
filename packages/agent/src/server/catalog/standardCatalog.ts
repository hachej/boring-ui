import type { ToolCatalog } from '../../shared/catalog'
import type { Sandbox } from '../../shared/sandbox'
import type { AgentTool, ToolResult } from '../../shared/tool'
import { createBashTool } from './tools/bashTool'
import { createEditTool } from './tools/editTool'
import { createFindFilesTool } from './tools/findFilesTool'
import { createGrepFilesTool } from './tools/grepFilesTool'
import { createReadTool } from './tools/readTool'
import { createWriteTool } from './tools/writeTool'

function makeError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
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

export const standardCatalog: ToolCatalog = ({
  workspace,
  sandbox,
  fileSearch,
}) => {
  const tools: AgentTool[] = [createBashTool(sandbox)]

  if (fileSearch) {
    tools.push(createFindFilesTool(fileSearch))
  }

  tools.push(createGrepFilesTool(sandbox))

  tools.push(
    createReadTool(workspace),
    createWriteTool(workspace),
    createEditTool(workspace),
  )

  if (sandbox.capabilities.includes('isolated-code')) {
    tools.push(createExecuteIsolatedCodeTool(sandbox))
  }

  return tools
}
