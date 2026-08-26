import { expectTypeOf, test } from 'vitest'

import {
  resolveWorkspacePackageResources,
  type ResolvedWorkspacePackageResourceRegistry,
} from '../index'

test('public package-resource resolver retains its required-only contract', () => {
  expectTypeOf<Awaited<ReturnType<typeof resolveWorkspacePackageResources>>>()
    .toEqualTypeOf<ResolvedWorkspacePackageResourceRegistry>()
  expectTypeOf<keyof NonNullable<Parameters<typeof resolveWorkspacePackageResources>[1]>>()
    .toEqualTypeOf<'sharedSkillPaths'>()
})
