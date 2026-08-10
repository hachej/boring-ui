import { expectTypeOf, it } from 'vitest'
import type {
  RuntimeFilesystemBindingOperations as BashOperations,
  RuntimeFilesystemCapability as BashCapability,
} from '@hachej/boring-bash/agent'
import type { RuntimeFilesystemBindingOperations, RuntimeFilesystemCapability } from '../mode'
it('keeps readonly filesystem contracts structurally aligned across packages', () => {
  expectTypeOf<RuntimeFilesystemCapability>().toEqualTypeOf<BashCapability>()
  expectTypeOf<RuntimeFilesystemBindingOperations>().toEqualTypeOf<BashOperations>()
})
