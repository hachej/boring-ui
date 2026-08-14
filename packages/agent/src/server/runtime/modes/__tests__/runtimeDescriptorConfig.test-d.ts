import type { SandboxRuntimeModeDescriptorV1 } from '@hachej/boring-sandbox/shared'

import {
  createSandboxRuntimeDescriptorAdapter,
  createSandboxRuntimeModeAdapter,
} from '../../sandboxRuntimeHost'

declare const configuredDescriptor: SandboxRuntimeModeDescriptorV1

createSandboxRuntimeDescriptorAdapter(configuredDescriptor)
createSandboxRuntimeModeAdapter('direct')

// Provider-specific configuration must be closed into its typed Sandbox descriptor.
// @ts-expect-error Agent host options contain no untyped provider option bag.
createSandboxRuntimeModeAdapter('direct', { providerOptions: {} })
