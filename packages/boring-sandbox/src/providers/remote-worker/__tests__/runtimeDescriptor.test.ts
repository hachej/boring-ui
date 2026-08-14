import { expect, test } from 'vitest'

import {
  REMOTE_WORKER_ERROR_CODES_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
} from '../../../shared/remoteWorkerProtocolV1'
import type { RemoteWorkerSandboxProviderOptionsV1 } from '../createRemoteWorkerProvider'
import { parseRemoteWorkerFleetConfigV1 } from '../fleetConfig'
import type { RemoteWorkerTransportV1 } from '../transport'
import {
  createRemoteWorkerRuntimeDescriptor,
  remoteWorkerRuntimeDescriptor,
} from '../runtimeDescriptor'

const digest = `sha256:${'a'.repeat(64)}` as const

function configuredRemoteWorkerDescriptor(
  transport: RemoteWorkerTransportV1 = {
    async request() { throw new Error('not used') },
    async openEventStream() { throw new Error('not used') },
  },
) {
  return createRemoteWorkerRuntimeDescriptor({
    fleet: parseRemoteWorkerFleetConfigV1({
      protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
      bucketCount: 256,
      workers: [{
        workerId: 'worker-1',
        baseUrl: 'https://worker-1.example.test',
        tokenFile: '/run/boring/worker-1.token',
        caFile: '/run/boring/fleet.ca',
        tlsServerName: 'worker-1.example.test',
        expectedEvidenceDigest: digest,
        expectedQualificationBundleDigest: digest,
        expectedProviderCohortDigest: digest,
        expectedImageDigest: digest,
        buckets: Array.from({ length: 256 }, (_, index) => index),
      }],
    }),
    capabilityIssuer: {
      async issueCapability() { return 'capability' },
    },
    bindingReceiptVerifier: {
      verifyBindingReceipt() { return true },
    },
    transport,
  })
}

test('the canonical registry descriptor fails closed while unconfigured', async () => {
  await expect(remoteWorkerRuntimeDescriptor.createPairFactory({}))
    .rejects.toMatchObject({ code: REMOTE_WORKER_ERROR_CODES_V1.configInvalid })
})

test('a malformed JavaScript configuration still fails with the canonical error', async () => {
  const descriptor = createRemoteWorkerRuntimeDescriptor(
    {} as RemoteWorkerSandboxProviderOptionsV1,
  )

  await expect(descriptor.createPairFactory({}))
    .rejects.toMatchObject({ code: REMOTE_WORKER_ERROR_CODES_V1.configInvalid })
})

test('rejects a malformed JavaScript transport without event streaming', async () => {
  const descriptor = configuredRemoteWorkerDescriptor({
    async request() { throw new Error('not used') },
  } as unknown as RemoteWorkerTransportV1)

  await expect(descriptor.createPairFactory({}))
    .rejects.toMatchObject({ code: REMOTE_WORKER_ERROR_CODES_V1.configInvalid })
})

test('a provider-owned configured descriptor constructs only the V1 provider', async () => {
  const descriptor = configuredRemoteWorkerDescriptor()
  const provider = await descriptor.createPairFactory({})

  expect(provider.providerId).toBe('remote-worker')
  expect(provider.contractVersion).toBe('boring-sandbox.provider.v1')
})

test('keeps the registered remote-worker descriptor V1-only and production unsafe', () => {
  expect(remoteWorkerRuntimeDescriptor.host.productionSafe).toBe(false)
  expect(remoteWorkerRuntimeDescriptor.providerId).toBe('remote-worker')
  expect(remoteWorkerRuntimeDescriptor.pair).toMatchObject({
    workspaceProviderId: 'remote-worker',
    sandboxProviderId: 'remote-worker',
  })
})
