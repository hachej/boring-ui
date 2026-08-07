import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ReadonlyFilesystemMutationError as BashReadonlyError,
  type RuntimeFilesystemAccessDecision as BashDecision,
  type RuntimeFilesystemBindingOperations as BashOperations,
  type RuntimeFilesystemCapability as BashCapability,
} from '@hachej/boring-bash/agent'
import {
  isReadonlyFilesystemMutationError,
  type RuntimeFilesystemAccessDecision,
  type RuntimeFilesystemBindingOperations,
  type RuntimeFilesystemCapability,
} from '../mode'

describe('readonly filesystem contract copies', () => {
  it('remain structurally aligned', () => {
    expectTypeOf<RuntimeFilesystemCapability>().toEqualTypeOf<BashCapability>()
    expectTypeOf<RuntimeFilesystemAccessDecision>().toEqualTypeOf<BashDecision>()
    expectTypeOf<RuntimeFilesystemBindingOperations>().toEqualTypeOf<BashOperations>()
  })
  it('recognizes coded errors across package boundaries', () => {
    expect(isReadonlyFilesystemMutationError(new BashReadonlyError('user', 'delete'))).toBe(true)
  })
})
