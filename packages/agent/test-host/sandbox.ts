export {
  agentSandboxRuntimeHostOperations as testRuntimeHostOperations,
  buildBwrapArgs,
  createAgentSandboxRuntimeModeAdapter as createTestRuntimeModeAdapter,
  createBwrapSandboxProvider,
  createBlaxelSandboxProvider,
  createDirectSandbox,
  createDirectSandboxProvider,
  createNodeWorkspace,
  createVercelSandboxProvider,
  createVercelProvisioningAdapter,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
  getBoringAgentRuntimePaths,
  VERCEL_SANDBOX_REMOTE_ROOT,
  BLAXEL_WORKSPACE_ROOT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from '../host/sandbox'
import {
  agentSandboxRuntimeHostOperations,
  createAgentSandboxRuntimeModeAdapter,
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
