import { ErrorCode } from '../../shared/error-codes'
import type { AgentTool, CatalogTool, ToolResult } from '../../shared/tool'

/**
 * Trust-routed dispatch (host side).
 *
 * The host composes a trust-annotated catalog ({@link CatalogTool}[]); this
 * module routes each entry to the concrete {@link AgentTool} the dispatcher may
 * invoke:
 *
 * - `trusted` → the original tool, executed in-process (today's path, unchanged).
 * - `untrusted` → a guarded stub. Its handler NEVER calls the underlying tool;
 *   it returns a stable, distinguishable error. The in-sandbox execution path
 *   for untrusted tools (the remote-exec bridge) is deferred to a later slice,
 *   so untrusted execution is refused here rather than silently run in-process.
 *
 * This is the safety property: an untrusted handler must never reach in-process
 * execution. Because the untrusted branch substitutes a stub before the tool
 * ever reaches the dispatcher, the property holds by construction (fail-closed).
 */

/** Stable code returned when an untrusted tool is invoked before the sandbox path exists. */
export const UNTRUSTED_TOOL_EXECUTION_CODE = ErrorCode.enum.TOOL_UNTRUSTED_EXECUTION_UNSUPPORTED

/**
 * Wrap an untrusted tool in a stub that refuses in-process execution. The stub
 * preserves the tool's advertised surface (name/description/parameters) so the
 * model still sees the tool, but its handler returns a stable error instead of
 * running the real — presumed-unsafe — handler.
 */
export function createUntrustedToolStub(tool: AgentTool): AgentTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.promptSnippet !== undefined ? { promptSnippet: tool.promptSnippet } : {}),
    ...(tool.readinessRequirements !== undefined
      ? { readinessRequirements: tool.readinessRequirements }
      : {}),
    execute(): Promise<ToolResult> {
      return Promise.resolve({
        content: [
          {
            type: 'text',
            text:
              `Tool "${tool.name}" is untrusted and cannot execute in-process. ` +
              'In-sandbox execution for untrusted tools is not yet supported.',
          },
        ],
        isError: true,
        details: { code: UNTRUSTED_TOOL_EXECUTION_CODE, tool: tool.name },
      })
    },
  }
}

/** Route a single host-assigned catalog entry to the tool the dispatcher may invoke. */
export function routeCatalogToolForDispatch(entry: CatalogTool): AgentTool {
  return entry.trust === 'trusted' ? entry.tool : createUntrustedToolStub(entry.tool)
}

/**
 * Route a trust-annotated catalog to a flat dispatch-ready list. Trusted tools
 * pass through by reference (behavior unchanged); untrusted tools are replaced
 * by guarded stubs so they can never run in-process.
 */
export function routeCatalogForDispatch(catalog: readonly CatalogTool[]): AgentTool[] {
  return catalog.map(routeCatalogToolForDispatch)
}
