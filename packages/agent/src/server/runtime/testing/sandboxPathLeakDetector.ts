import type { RuntimeModeId } from '../mode'
import type { AgentTool, ToolResult } from '../../../shared/tool'

export interface SandboxPathLeakDetectorOptions {
  runtimeMode?: RuntimeModeId
  sandboxProvider?: string
  /** Adapter-private host root. Required only for local/bwrap checks. */
  hostWorkspaceRoot?: string
}

export interface SandboxPathLeakCheckInput extends SandboxPathLeakDetectorOptions {
  label: string
  text?: string
  texts?: string[]
}

interface ForbiddenPath {
  path: string
  reason: string
}

function normalizeHostRoot(path: string | undefined): string | undefined {
  if (!path) return undefined
  const trimmed = path.trim().replace(/[/\\]+$/, '')
  return trimmed.length > 0 ? trimmed : undefined
}

function forbiddenPaths(opts: SandboxPathLeakDetectorOptions): ForbiddenPath[] {
  const provider = opts.sandboxProvider ?? opts.runtimeMode
  if (provider === 'bwrap' || provider === 'local') {
    const hostRoot = normalizeHostRoot(opts.hostWorkspaceRoot)
    return hostRoot
      ? [{ path: hostRoot, reason: 'local/bwrap model-facing text must use /workspace, not the host workspace root' }]
      : []
  }
  if (provider === 'vercel-sandbox') {
    return [{ path: '/vercel/sandbox', reason: 'Vercel model-facing text must use /workspace, not the internal sandbox root' }]
  }
  return []
}

function containsPath(text: string, path: string): boolean {
  if (!path) return false
  if (text.includes(path)) return true
  const withoutTrailingSlash = path.replace(/\/+$/, '')
  return withoutTrailingSlash !== path && text.includes(withoutTrailingSlash)
}

export function assertNoSandboxPathLeaks(input: SandboxPathLeakCheckInput): void {
  const forbidden = forbiddenPaths(input)
  if (forbidden.length === 0) return

  const texts = [input.text, ...(input.texts ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  for (const text of texts) {
    for (const candidate of forbidden) {
      if (containsPath(text, candidate.path)) {
        throw new Error(
          `Sandbox path leak detected in ${input.label}: ${candidate.reason} (${candidate.path})`,
        )
      }
    }
  }
}

function resultTexts(result: ToolResult): string[] {
  return result.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
}

/**
 * Test/dev-only guard for model-facing tool prompt snippets and observations.
 * Do not use it to rewrite command strings or outputs; adapters own cwd/env.
 */
export function wrapToolsWithSandboxPathLeakDetector(
  tools: AgentTool[],
  opts: SandboxPathLeakDetectorOptions,
): AgentTool[] {
  return tools.map((tool) => {
    assertNoSandboxPathLeaks({
      ...opts,
      label: `tool ${tool.name} prompt`,
      texts: [tool.description, tool.promptSnippet ?? ''],
    })

    return {
      ...tool,
      async execute(params, ctx) {
        const guardedCtx = ctx.onUpdate
          ? {
              ...ctx,
              onUpdate(partial: string) {
                assertNoSandboxPathLeaks({
                  ...opts,
                  label: `tool ${tool.name} streaming observation`,
                  text: partial,
                })
                ctx.onUpdate?.(partial)
              },
            }
          : ctx
        const result = await tool.execute(params, guardedCtx)
        assertNoSandboxPathLeaks({
          ...opts,
          label: `tool ${tool.name} observation`,
          texts: resultTexts(result),
        })
        return result
      },
    }
  })
}
