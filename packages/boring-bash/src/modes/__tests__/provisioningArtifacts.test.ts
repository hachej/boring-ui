import { expect, test } from 'vitest'

import { resolveArtifactInstallSource } from '../provisioningArtifacts'

function createWorkspaceFs() {
  return {
    async exists() {
      return false
    },
    async copyFromHost() {},
  }
}

test('resolveArtifactInstallSource wraps system errors with stable artifact code', async () => {
  const error = new Error('missing pnpm') as Error & { code: string }
  error.code = 'ENOENT'

  await expect(resolveArtifactInstallSource({
    workspaceFs: createWorkspaceFs(),
    prepareArtifact: async () => {
      throw error
    },
    runtimeTmpDir: '/workspace/.boring-agent/tmp',
    source: '/missing',
    opts: {
      kind: 'node',
      id: 'pkg',
      fingerprint: 'sha256:abc',
    },
  })).rejects.toMatchObject({
    name: 'ProvisioningError',
    code: 'PROVISIONING_ARTIFACT_FAILED',
    details: {
      phase: 'adapter-artifact',
      runtime: 'node',
      id: 'pkg',
    },
  })
})

test('resolveArtifactInstallSource preserves existing stable provisioning errors', async () => {
  const error = new Error('stable failure') as Error & { code: string }
  error.name = 'ProvisioningError'
  error.code = 'PROVISIONING_NPM_INSTALL_FAILED'

  await expect(resolveArtifactInstallSource({
    workspaceFs: createWorkspaceFs(),
    prepareArtifact: async () => {
      throw error
    },
    runtimeTmpDir: '/workspace/.boring-agent/tmp',
    source: '/missing',
    opts: {
      kind: 'node',
      id: 'pkg',
      fingerprint: 'sha256:abc',
    },
  })).rejects.toBe(error)
})
