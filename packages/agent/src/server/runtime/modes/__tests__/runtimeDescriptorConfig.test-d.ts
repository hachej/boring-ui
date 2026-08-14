import { expectTypeOf, test } from 'vitest'

import type { SandboxRuntimeModeDescriptorV1 } from '@hachej/boring-sandbox/shared'

import {
  createSandboxRuntimeDescriptorAdapter,
  createSandboxRuntimeModeAdapter,
} from '../../sandboxRuntimeHost'

test('provider configuration is closed before generic Agent composition', () => {
  expectTypeOf<Parameters<typeof createSandboxRuntimeDescriptorAdapter>[0]>()
    .toEqualTypeOf<SandboxRuntimeModeDescriptorV1>()

  type HostOptions = NonNullable<Parameters<typeof createSandboxRuntimeModeAdapter>[1]>
  // @ts-expect-error Agent host options contain no untyped provider option bag.
  const invalidOptions: HostOptions = { providerOptions: {} }
  void invalidOptions
})
