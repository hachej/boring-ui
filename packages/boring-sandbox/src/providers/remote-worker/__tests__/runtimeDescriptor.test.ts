import { expect, test } from 'vitest'

import { REMOTE_WORKER_ERROR_CODES_V1 } from '../../../shared/remoteWorkerProtocolV1'
import { remoteWorkerRuntimeDescriptor } from '../runtimeDescriptor'

test.each([
  undefined,
  {},
  { baseUrl: 'http://legacy-worker', token: 'legacy-token' },
  { fleet: {} },
])('fails closed with the canonical config error for absent or incomplete V1 options: %j', async (providerOptions) => {
  await expect(remoteWorkerRuntimeDescriptor.createPairFactory({ providerOptions }))
    .rejects.toMatchObject({ code: REMOTE_WORKER_ERROR_CODES_V1.configInvalid })
})

test('keeps the registered remote-worker descriptor V1-only and production unsafe', async () => {
  expect(remoteWorkerRuntimeDescriptor.host.productionSafe).toBe(false)
  expect(remoteWorkerRuntimeDescriptor.providerId).toBe('remote-worker')
  expect(remoteWorkerRuntimeDescriptor.pair).toMatchObject({
    workspaceProviderId: 'remote-worker',
    sandboxProviderId: 'remote-worker',
  })
})
