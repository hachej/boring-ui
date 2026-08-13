export {
  buildBwrapArgs,
  createBwrapSandboxProvider,
} from '@hachej/boring-sandbox/providers/bwrap'
export {
  BLAXEL_WORKSPACE_ROOT,
  createBlaxelSandboxProvider,
} from '@hachej/boring-sandbox/providers/blaxel'
export {
  createDirectSandbox,
  createDirectSandboxProvider,
} from '@hachej/boring-sandbox/providers/direct'
export {
  createNodeWorkspace,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
  getBoringAgentRuntimePaths,
} from '@hachej/boring-sandbox/providers/node-workspace'
export {
  createVercelProvisioningAdapter,
  createVercelSandboxProvider,
  VERCEL_SANDBOX_REMOTE_ROOT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from '@hachej/boring-sandbox/providers/vercel-sandbox'
import {
  agentSandboxRuntimeHostOperations,
  createAgentSandboxRuntimeModeAdapter,
} from '../host/sandbox'
export {
  agentSandboxRuntimeHostOperations as testRuntimeHostOperations,
  createAgentSandboxRuntimeModeAdapter as createTestRuntimeModeAdapter,
} from '../host/sandbox'
import {
  createStandaloneAgentHostApp,
  type CreateStandaloneAgentHostAppOptions,
} from '../src/server/createStandaloneAgentHostApp'
import { isBuiltinRuntimeModeId } from '../src/shared/runtime-mode'

export async function createTestStandaloneAgentHostApp(
  options: CreateStandaloneAgentHostAppOptions = {},
): ReturnType<typeof createStandaloneAgentHostApp> {
  const mode = options.runtimeModeAdapter?.id ?? options.mode ?? 'direct'
  const runtimeModeAdapter = options.runtimeModeAdapter
    ?? (isBuiltinRuntimeModeId(mode)
      ? createAgentSandboxRuntimeModeAdapter(mode)
      : undefined)
  return await createStandaloneAgentHostApp({
    ...options,
    ...(runtimeModeAdapter ? { runtimeModeAdapter } : {}),
    runtimeHost: options.runtimeHost ?? agentSandboxRuntimeHostOperations,
  })
}
