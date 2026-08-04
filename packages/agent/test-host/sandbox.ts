export {
  agentSandboxRuntimeHostOperations as testRuntimeHostOperations,
  buildBwrapArgs,
  createAgentSandboxRuntimeModeAdapter as createTestRuntimeModeAdapter,
  createBwrapSandboxProvider,
  createDirectSandbox,
  createDirectSandboxProvider,
  createNodeWorkspace,
  createVercelSandboxProvider,
  createVercelProvisioningAdapter,
  getBoringAgentPathEntries,
  getBoringAgentRuntimeEnv,
  getBoringAgentRuntimePaths,
  VERCEL_SANDBOX_REMOTE_ROOT,
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

export async function createTestStandaloneAgentHostApp(
  options: CreateStandaloneAgentHostAppOptions = {},
): ReturnType<typeof createStandaloneAgentHostApp> {
  const mode = options.runtimeModeAdapter?.id ?? options.mode ?? 'direct'
  const runtimeModeAdapter = options.runtimeModeAdapter
    ?? (mode === 'direct' || mode === 'local' || mode === 'vercel-sandbox'
      ? createAgentSandboxRuntimeModeAdapter(mode)
      : undefined)
  return await createStandaloneAgentHostApp({
    ...options,
    ...(runtimeModeAdapter ? { runtimeModeAdapter } : {}),
    runtimeHost: options.runtimeHost ?? agentSandboxRuntimeHostOperations,
  })
}
