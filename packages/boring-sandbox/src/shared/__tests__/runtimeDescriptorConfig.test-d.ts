import { expectTypeOf } from 'vitest'

import { createDirectRuntimeDescriptor } from '../../providers/direct/runtimeDescriptor'
import { createRemoteWorkerRuntimeDescriptor } from '../../providers/remote-worker/runtimeDescriptor'
import { createVercelSandboxRuntimeDescriptor } from '../../providers/vercel-sandbox/runtimeDescriptor'
import type { SandboxRuntimeModeDescriptorV1 } from '../runtimeDescriptor'

const directDescriptor = createDirectRuntimeDescriptor()
const vercelDescriptor = createVercelSandboxRuntimeDescriptor({
  getEnvVar: (name) => name,
})

expectTypeOf(directDescriptor).toMatchTypeOf<SandboxRuntimeModeDescriptorV1>()
expectTypeOf(vercelDescriptor).toMatchTypeOf<SandboxRuntimeModeDescriptorV1>()

// Provider configuration is closed into a typed descriptor before generic composition.
// @ts-expect-error Vercel options do not configure a remote-worker descriptor.
createRemoteWorkerRuntimeDescriptor({ getEnvVar: () => undefined })
// @ts-expect-error Remote-worker options do not configure a Vercel descriptor.
createVercelSandboxRuntimeDescriptor({ fleet: {} })
// @ts-expect-error The generic pair factory accepts only host-owned options.
directDescriptor.createPairFactory({ providerOptions: {} })
