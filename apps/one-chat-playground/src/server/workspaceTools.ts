import path from 'node:path'

import type { PiExtensionFactory } from '@hachej/boring-agent/server'
import type { AgentTool, Sandbox, Workspace } from '@hachej/boring-agent/shared'
import {
  createBrokeredSandboxTool,
  parseBrokeredSandboxToolManifest,
} from '@hachej/boring-workspace/server'

export const TOOLS_RELATIVE_DIR = path.join('agent', 'tools')

async function toolFiles(workspace: Workspace): Promise<string[]> {
  try {
    return (await workspace.readdir(TOOLS_RELATIVE_DIR))
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

export async function loadWorkspaceTools(options: {
  readonly workspace: Workspace
  readonly sandbox: Sandbox
  readonly reservedNames?: ReadonlySet<string>
  readonly allowUnisolatedDirectExecution?: boolean
}): Promise<AgentTool[]> {
  const tools: AgentTool[] = []
  const names = new Set<string>()
  for (const fileName of await toolFiles(options.workspace)) {
    const manifestPath = path.join(TOOLS_RELATIVE_DIR, fileName)
    const scriptPath = path.join(
      TOOLS_RELATIVE_DIR,
      `${fileName.slice(0, -5)}.ts`,
    )
    let raw: unknown
    try {
      raw = JSON.parse(await options.workspace.readFile(manifestPath))
    } catch (error) {
      throw new Error(
        `${manifestPath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const manifest = parseBrokeredSandboxToolManifest(raw)
    if (names.has(manifest.name))
      throw new Error(`${manifestPath}: duplicate tool name ${manifest.name}`)
    if (options.reservedNames?.has(manifest.name))
      throw new Error(`${manifestPath}: tool name ${manifest.name} is reserved`)
    try {
      const script = await options.workspace.stat(scriptPath)
      if (script.kind !== 'file') throw new Error('not a file')
    } catch {
      throw new Error(
        `${manifestPath}: matching script ${scriptPath} is missing`,
      )
    }
    names.add(manifest.name)
    tools.push(
      createBrokeredSandboxTool(manifest, {
        workspace: options.workspace,
        sandbox: options.sandbox,
        allowUnisolatedDirectExecution: options.allowUnisolatedDirectExecution,
      }),
    )
  }
  return tools
}

/** One stable host factory; Pi reruns it on reload and receives a fresh manifest snapshot. */
export function createWorkspaceToolsExtension(options: {
  readonly workspace: Workspace
  readonly sandbox: Sandbox
  readonly reservedNames?: ReadonlySet<string>
  readonly allowUnisolatedDirectExecution?: boolean
}): PiExtensionFactory {
  return async (pi) => {
    const tools = await loadWorkspaceTools(options)
    for (const tool of tools) {
      pi.registerTool({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        async execute(toolCallId, params, signal) {
          const input =
            params && typeof params === 'object' && !Array.isArray(params)
              ? (params as Record<string, unknown>)
              : {}
          const result = await tool.execute(input, {
            abortSignal: signal ?? new AbortController().signal,
            toolCallId,
          })
          return { ...result, details: result.details ?? {} }
        },
      })
    }
  }
}
