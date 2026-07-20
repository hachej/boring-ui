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
  createAgentApp as createAgentAppBase,
  type CreateAgentAppOptions,
} from '../src/server/createAgentApp'
import {
  registerAgentRoutes as registerAgentRoutesBase,
  type RegisterAgentRoutesOptions,
} from '../src/server/registerAgentRoutes'
import type { FastifyInstance } from 'fastify'

export async function createTestAgentApp(
  options: CreateAgentAppOptions = {},
): ReturnType<typeof createAgentAppBase> {
  const mode = options.runtimeModeAdapter?.id ?? options.mode ?? 'direct'
  const runtimeModeAdapter = options.runtimeModeAdapter
    ?? (mode === 'direct' || mode === 'local' || mode === 'vercel-sandbox'
      ? createAgentSandboxRuntimeModeAdapter(mode)
      : undefined)
  return await createAgentAppBase({
    ...options,
    ...(runtimeModeAdapter ? { runtimeModeAdapter } : {}),
    runtimeHost: options.runtimeHost ?? agentSandboxRuntimeHostOperations,
  })
}

export async function registerTestAgentRoutes(
  app: FastifyInstance,
  options: RegisterAgentRoutesOptions,
): Promise<void> {
  const mode = options.runtimeModeAdapter?.id ?? options.mode ?? 'direct'
  const runtimeModeAdapter = options.runtimeModeAdapter
    ?? (mode === 'direct' || mode === 'local' || mode === 'vercel-sandbox'
      ? createAgentSandboxRuntimeModeAdapter(mode)
      : undefined)
  await registerAgentRoutesBase(app, {
    ...options,
    ...(runtimeModeAdapter ? { runtimeModeAdapter } : {}),
    runtimeHost: options.runtimeHost ?? agentSandboxRuntimeHostOperations,
  })
}
