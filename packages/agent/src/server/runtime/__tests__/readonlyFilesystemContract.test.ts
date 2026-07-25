import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ReadonlyFilesystemMutationError as BashReadonlyFilesystemMutationError,
  isReadonlyFilesystemMutationError as isBashReadonlyFilesystemMutationError,
  type RuntimeFilesystemAccessDecision as BashAccessDecision,
  type RuntimeFilesystemBindingOperations as BashBindingOperations,
  type RuntimeFilesystemCapability as BashCapability,
} from '@hachej/boring-bash/agent'

import {
  ReadonlyFilesystemMutationError,
  isReadonlyFilesystemMutationError,
  type RuntimeFilesystemAccessDecision,
  type RuntimeFilesystemBindingOperations,
  type RuntimeFilesystemCapability,
} from '../mode'

describe('readonly filesystem contract copies', () => {
  it('remain structurally aligned', () => {
    expectTypeOf<RuntimeFilesystemCapability>().toEqualTypeOf<BashCapability>()
    expectTypeOf<RuntimeFilesystemAccessDecision>().toEqualTypeOf<BashAccessDecision>()
    expectTypeOf<RuntimeFilesystemBindingOperations>().toEqualTypeOf<BashBindingOperations>()
  })

  it('recognizes coded errors across the package boundary without instanceof', () => {
    const agentError = new ReadonlyFilesystemMutationError('user', 'write')
    const bashError = new BashReadonlyFilesystemMutationError('user', 'delete')

    expect(isBashReadonlyFilesystemMutationError(agentError)).toBe(true)
    expect(isReadonlyFilesystemMutationError(bashError)).toBe(true)
  })
})
