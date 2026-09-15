import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type {
  SandboxProviderCreateContextV1,
  SandboxProviderV1,
  WorkspaceSandboxPairV1,
} from '../../../shared/providerV1'
import { PROVIDER_CONTRACT_VERSION } from '../../../shared/providerMatrix'

export interface ProviderPairConformanceHarness {
  provider: SandboxProviderV1
  context: SandboxProviderCreateContextV1
  cleanup?: () => Promise<void>
}

export interface ProviderPairConformanceOptions {
  expectProvisioning?: boolean
  skip?: boolean
  skipReason?: string
}

export function providerPairConformance(
  targetId: string,
  make: () => Promise<ProviderPairConformanceHarness>,
  options: ProviderPairConformanceOptions = {},
): void {
  const scopedDescribe = options.skip ? describe.skip : describe
  const title = options.skip && options.skipReason
    ? `[${targetId}] provider pair conformance (${options.skipReason})`
    : `[${targetId}] provider pair conformance`

  scopedDescribe(title, () => {
    let harness: ProviderPairConformanceHarness | undefined
    let pair: WorkspaceSandboxPairV1 | undefined

    beforeEach(async () => {
      harness = await make()
      pair = await harness.provider.create(harness.context)
    })

    afterEach(async () => {
      await pair?.dispose()
      await harness?.cleanup?.()
      pair = undefined
      harness = undefined
    })

    test('acquires one matching Workspace + Sandbox result', () => {
      expect(harness?.provider.contractVersion).toBe(PROVIDER_CONTRACT_VERSION)
      expect(pair?.workspace).toBeDefined()
      expect(pair?.sandbox).toBeDefined()
      expect(pair?.workspace.runtimeContext.runtimeCwd).toBe(
        pair?.sandbox.runtimeContext.runtimeCwd,
      )
      expect(pair?.sandbox.runtimeContext.runtimeCwd).toBe(
        harness?.provider.resolveRuntimeRoot(harness.context),
      )
    })

    test('exposes provisioning only from the acquired pair', () => {
      expect('provisioning' in harness!.provider).toBe(false)
      expect(Boolean(pair?.provisioning)).toBe(Boolean(options.expectProvisioning))
    })

    test('disposes the pair idempotently', async () => {
      await expect(pair!.dispose()).resolves.toBeUndefined()
      await expect(pair!.dispose()).resolves.toBeUndefined()
    })
  })
}
