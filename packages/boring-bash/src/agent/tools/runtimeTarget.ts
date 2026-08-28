import type { AgentTool, ToolExecContext } from '@hachej/boring-agent/shared'

const SANDBOX_HANDLE_PATTERN = '^[A-Za-z0-9_-]{16,128}$'

export interface SandboxTargetToolOptions {
  /** Build the canonical tool for the resolved leased runtime and invoke it while pinned. */
  executeTargeted(
    sandbox: string,
    params: Record<string, unknown>,
    ctx: ToolExecContext,
  ): Promise<Awaited<ReturnType<AgentTool['execute']>>>
}

function withSandboxParameter(parameters: AgentTool['parameters']): AgentTool['parameters'] {
  const properties = parameters.properties && typeof parameters.properties === 'object'
    ? { ...(parameters.properties as Record<string, unknown>) }
    : {}
  return {
    ...parameters,
    properties: {
      ...properties,
      sandbox: {
        type: 'string',
        pattern: SANDBOX_HANDLE_PATTERN,
        description: 'Opaque disposable sandbox lease. Omit to use the primary user workspace.',
      },
    },
  }
}

/**
 * Adds explicit disposable-sandbox targeting around one canonical Pi-backed tool.
 * The original tool is called byte-for-byte when `sandbox` is omitted; target
 * resolution therefore happens before any primary-runtime readiness checks.
 */
export function withSandboxTarget(
  primary: AgentTool,
  options: SandboxTargetToolOptions,
): AgentTool {
  return {
    ...primary,
    parameters: withSandboxParameter(primary.parameters),
    async execute(params, ctx) {
      const requested = params.sandbox
      if (requested === undefined) return await primary.execute(params, ctx)
      if (typeof requested !== 'string' || !new RegExp(SANDBOX_HANDLE_PATTERN).test(requested)) {
        return {
          content: [{ type: 'text', text: 'sandbox lease is invalid' }],
          isError: true,
          details: { code: 'SANDBOX_TARGET_INVALID', retryable: false },
        }
      }
      if (typeof params.filesystem === 'string' && params.filesystem !== '' && params.filesystem !== 'user') {
        return {
          content: [{ type: 'text', text: 'named filesystems cannot be combined with a sandbox lease' }],
          isError: true,
          details: { code: 'SANDBOX_TARGET_INVALID', retryable: false },
        }
      }
      const { sandbox: _sandbox, ...targetParams } = params
      return await options.executeTargeted(requested, targetParams, ctx)
    },
  }
}
