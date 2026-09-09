import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { initializeLocalFileCredentialVersionAnchorV1 } from '@hachej/boring-agent/server'
import { createTestCoreConfig } from '../../../server/__tests__/createTestApp.js'
import { mocks } from './createCoreWorkspaceAgentServer.testHarness.js'

const CREDENTIAL_ENV_KEYS = [
  'BORING_CREDENTIAL_KMS_BACKEND',
  'BORING_CREDENTIAL_LOCAL_KEK_FILE',
  'BORING_CREDENTIAL_LOCAL_KEK_ANCHOR_FILE',
  'BORING_CREDENTIAL_PERSISTENCE',
] as const
const originalCredentialEnv = Object.fromEntries(
  CREDENTIAL_ENV_KEYS.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  for (const key of CREDENTIAL_ENV_KEYS) {
    const value = originalCredentialEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function emptySql() {
  const sql = Object.assign(
    () => Promise.resolve([]),
    {
      unsafe: vi.fn(async () => []),
      end: vi.fn(async () => {}),
    },
  )
  return sql
}

async function configureLocalKek(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'core-credential-routes-'))
  const keyFilePath = join(dir, 'kek')
  const anchorFilePath = join(dir, 'credential-anchor')
  await writeFile(keyFilePath, Buffer.alloc(32, 0x2a).toString('hex'))
  await initializeLocalFileCredentialVersionAnchorV1({
    anchorFilePath,
    loadKek: async () => new Uint8Array(Buffer.alloc(32, 0x2a)),
  })
  process.env.BORING_CREDENTIAL_KMS_BACKEND = 'local-kek'
  process.env.BORING_CREDENTIAL_LOCAL_KEK_FILE = keyFilePath
  process.env.BORING_CREDENTIAL_LOCAL_KEK_ANCHOR_FILE = anchorFilePath
  process.env.BORING_CREDENTIAL_PERSISTENCE = 'memory'
}

async function createServer(credentials: boolean) {
  const sql = emptySql()
  mocks.createDatabase.mockReturnValueOnce({ db: {}, sql })
  mocks.collectWorkspaceAgentServerPlugins.mockReturnValue({
    runtimePlugins: [],
    agentOptions: { extraTools: [], pi: {}, systemPromptAppend: undefined },
    preservedUiStateKeys: [],
    routeContributions: [],
    workspaceBridgeHandlers: [],
  })
  mocks.createAgentHost.mockImplementationOnce(async (options) => {
    return await mocks.actualCreateAgentHost!({
      ...options,
      inMemoryRequestLedgerMode: 'test',
      requestLedgerPath: undefined,
      sessionRoot: undefined,
      hostId: 'core-credential-route-test',
    })
  })
  mocks.getWorkspace.mockImplementation(async (id: string) => ({
    id,
    appId: 'boring-ui-v2-test',
    defaultAgentTypeId: 'default',
  }))
  const { createCoreWorkspaceAgentServer } = await import('../createCoreWorkspaceAgentServer.js')
  return await createCoreWorkspaceAgentServer({
    config: createTestCoreConfig({ stores: 'postgres', databaseUrl: 'postgres://test' }),
    workspaceRoot: await mkdtemp(join(tmpdir(), 'core-credential-workspaces-')),
    serveFrontend: false,
    credentials,
  })
}

test('mounts configured owner credential metadata routes without exposing secret fields', async () => {
  await configureLocalKek()
  const app = await createServer(true)
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/credentials',
      headers: {
        'x-test-user-id': 'owner-a',
        'x-boring-workspace-id': 'workspace-a',
      },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<{
      credentials: Array<Record<string, unknown>>
    }>()
    expect(body).toEqual({
      credentials: expect.arrayContaining([
        expect.objectContaining({ providerId: 'openai-codex', state: 'not_configured' }),
      ]),
    })
    for (const credential of body.credentials) {
      expect(Object.keys(credential).sort()).toEqual([
        'credentialType',
        'displayName',
        'providerId',
        'state',
      ])
    }

    mocks.getMemberRole.mockResolvedValueOnce('member')
    const nonOwner = await app.inject({
      method: 'GET',
      url: '/api/v1/credentials',
      headers: {
        'x-test-user-id': 'member-a',
        'x-boring-workspace-id': 'workspace-a',
      },
    })
    expect(nonOwner.statusCode).toBe(403)
  } finally {
    await app.close()
  }
}, 30_000)

test('leaves credential routes absent when BYOK configuration is absent', async () => {
  for (const key of CREDENTIAL_ENV_KEYS) delete process.env[key]
  const app = await createServer(true)
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/credentials',
      headers: {
        'x-test-user-id': 'owner-a',
        'x-boring-workspace-id': 'workspace-a',
      },
    })
    expect(response.statusCode).toBe(404)
  } finally {
    await app.close()
  }
}, 30_000)
