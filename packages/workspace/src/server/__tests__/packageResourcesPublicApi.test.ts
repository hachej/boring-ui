import { expectTypeOf, test } from 'vitest'

import {
  resolveWorkspacePackageResources,
  type ResolvedWorkspacePackageResourceRegistry,
} from '../index'

test('public package-resource resolver retains the registry return contract', () => {
  expectTypeOf<Awaited<ReturnType<typeof resolveWorkspacePackageResources>>>()
    .toEqualTypeOf<ResolvedWorkspacePackageResourceRegistry>()
})
