import { link, mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createD1CoreEnvAuthorityReaderForPolicy,
  D1_CORE_ENV_AUTHORITY_POLICY,
  D1_CORE_ENV_MAX_BYTES,
  D1_CORE_ENV_PATH,
  type D1CoreEnvAuthorityPolicy,
} from '../d1CoreEnvAuthority.js'
import { D1HostError, D1HostErrorCode } from '../d1Plan.js'

const UID = process.geteuid!()
const GID = process.getegid!()
const CANARY = 'core-env-secret-canary-never-leaks'
const VALUES = Object.freeze({
  BORING_D1_OWNER_UID: '0',
  DATABASE_URL_FILE: '/run/boring/d1/host-secrets/database-url',
  BETTER_AUTH_SECRET_FILE: '/run/boring/d1/host-secrets/better-auth-secret',
  WORKSPACE_SETTINGS_ENCRYPTION_KEY_FILE: '/run/boring/d1/host-secrets/workspace-settings-encryption-key',
  BORING_PLUGIN_AUTHORING: '0',
  BETTER_AUTH_URL: 'https://auth.example.test',
  CORS_ORIGINS: 'https://a.example.test,https://z.example.test',
  CSP_ENABLED: 'true',
  CSP_UPGRADE_INSECURE_REQUESTS: 'true',
  SESSION_COOKIE_SECURE: 'true',
  BORING_MCP_PROD_ENABLED: '0',
  BORING_MANAGED_AGENT_MCP_ENABLED: '0',
  BORING_D1_MAX_BINDINGS: '20',
  BORING_D1_MAX_BUNDLE_BYTES: '1000000',
  BORING_D1_MAX_TOTAL_BUNDLE_BYTES: '10000000',
  BORING_D1_MAX_CONCURRENT_PRELOADS: '4',
})
const CANONICAL = Object.entries(VALUES).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'

async function fixture(content: string | Uint8Array = CANONICAL) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-core-env-'))
  const directoryPath = path.join(parent, 'd1')
  await mkdir(directoryPath, { mode: 0o755 })
  const file = path.join(directoryPath, 'core.env')
  await writeFile(file, content, { mode: 0o444 })
  const policy: D1CoreEnvAuthorityPolicy = {
    directoryPath,
    directoryUid: UID,
    directoryGid: GID,
    directoryMode: 0o755,
    fileUid: UID,
    fileGid: GID,
    fileMode: 0o444,
    maxBytes: D1_CORE_ENV_MAX_BYTES,
  }
  return { directoryPath, file, policy }
}

function reader(policy: D1CoreEnvAuthorityPolicy) {
  return createD1CoreEnvAuthorityReaderForPolicy(policy)
}

async function expectUnavailable(action: Promise<unknown>): Promise<void> {
  const failure = await action.catch((error) => error)
  expect(failure).toEqual(expect.objectContaining({
    code: D1HostErrorCode.COLLECTION_NOT_READY,
    details: { field: 'coreEnv' },
  }))
  expect(`${String(failure)}${JSON.stringify(failure)}`).not.toMatch(
    new RegExp(`${CANARY}|boring-d1-core-env-|core\\.env|/etc/boring`),
  )
}

function expectUnavailableSync(action: () => unknown): void {
  let failure: unknown
  try { action() } catch (error) { failure = error }
  expect(failure).toEqual(expect.objectContaining({
    code: D1HostErrorCode.COLLECTION_NOT_READY,
    details: { field: 'coreEnv' },
  }))
  expect(`${String(failure)}${JSON.stringify(failure)}`).not.toContain(CANARY)
}

describe('D1 core.env authority', () => {
  it('reads a detached, deeply frozen, exact 16-key record', async () => {
    const h = await fixture()
    const authorityReader = reader(h.policy)
    const result = await authorityReader.read()
    expect(result).toEqual(VALUES)
    expect(Object.keys(result)).toHaveLength(16)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(authorityReader)).toBe(true)
    expect(result).not.toHaveProperty('COMPOSIO_API_KEY')
    expect(result).not.toHaveProperty('BORING_MANAGED_AGENT_MCP_BEARER_TOKEN')
  })

  it('hard-codes the production path and root-owned immutable policy', () => {
    expect(D1_CORE_ENV_PATH).toBe('/etc/boring/d1/core.env')
    expect(D1_CORE_ENV_AUTHORITY_POLICY).toEqual({
      directoryPath: '/etc/boring/d1',
      directoryUid: 0,
      directoryGid: 0,
      directoryMode: 0o755,
      fileUid: 0,
      fileGid: 0,
      fileMode: 0o444,
      maxBytes: 64 * 1024,
    })
    expect(Object.isFrozen(D1_CORE_ENV_AUTHORITY_POLICY)).toBe(true)
  })

  it.each([
    ['reordered', CANONICAL.split('\n').slice(0, -1).reverse().join('\n') + '\n'],
    ['duplicate', `${CANONICAL}BORING_D1_OWNER_UID=0\n`],
    ['comment', `# ${CANARY}\n${CANONICAL}`],
    ['blank', `\n${CANONICAL}`],
    ['quoted', CANONICAL.replace('BORING_D1_OWNER_UID=0', 'BORING_D1_OWNER_UID="0"')],
    ['export', CANONICAL.replace('BORING_D1_OWNER_UID=0', 'export BORING_D1_OWNER_UID=0')],
    ['colon delimiter', CANONICAL.replace('BORING_D1_OWNER_UID=0', 'BORING_D1_OWNER_UID: 0')],
    ['CRLF', CANONICAL.replaceAll('\n', '\r\n')],
    ['missing final LF', CANONICAL.slice(0, -1)],
    ['interpolation', CANONICAL.replace('BORING_D1_OWNER_UID=0', 'BORING_D1_OWNER_UID=$OWNER_UID')],
    ['escape', CANONICAL.replace('BORING_D1_OWNER_UID=0', 'BORING_D1_OWNER_UID=\\0')],
    ['unknown', `${CANONICAL}UNKNOWN_BEHAVIOR=${CANARY}\n`],
    ['loader', `${CANONICAL}NODE_OPTIONS=${CANARY}\n`],
    ['raw secret', `${CANONICAL}DATABASE_URL=${CANARY}\n`],
    ['Composio secret', `${CANONICAL}COMPOSIO_API_KEY=${CANARY}\n`],
    ['managed bearer', `${CANONICAL}BORING_MANAGED_AGENT_MCP_BEARER_TOKEN=${CANARY}\n`],
    ['managed workspace target', `${CANONICAL}BORING_MANAGED_AGENT_MCP_WORKSPACE_ID=${CANARY}\n`],
    ['managed user target', `${CANONICAL}BORING_MANAGED_AGENT_MCP_USER_ID=${CANARY}\n`],
    ['managed enabled', CANONICAL.replace('BORING_MANAGED_AGENT_MCP_ENABLED=0', 'BORING_MANAGED_AGENT_MCP_ENABLED=1')],
    ['wrong selector', CANONICAL.replace('/run/boring/d1/host-secrets/database-url', `/tmp/${CANARY}`)],
    ['invalid UTF-8', new Uint8Array([0xff])],
  ])('rejects noncanonical %s input with one bounded error', async (_name, content) => {
    const h = await fixture(content)
    await expectUnavailable(reader(h.policy).read())
  })

  it.each([
    ['directory owner', (p: D1CoreEnvAuthorityPolicy) => ({ ...p, directoryUid: p.directoryUid + 1 })],
    ['directory group', (p: D1CoreEnvAuthorityPolicy) => ({ ...p, directoryGid: p.directoryGid + 1 })],
    ['directory mode', (p: D1CoreEnvAuthorityPolicy) => ({ ...p, directoryMode: 0o750 })],
    ['file owner', (p: D1CoreEnvAuthorityPolicy) => ({ ...p, fileUid: p.fileUid + 1 })],
    ['file group', (p: D1CoreEnvAuthorityPolicy) => ({ ...p, fileGid: p.fileGid + 1 })],
    ['file mode', (p: D1CoreEnvAuthorityPolicy) => ({ ...p, fileMode: 0o440 })],
  ])('rejects wrong %s metadata', async (_name, mutate) => {
    const h = await fixture()
    await expectUnavailable(reader(mutate(h.policy)).read())
  })

  it('rejects symlinked directories and symlinked or hard-linked files', async () => {
    for (const mutation of ['directory-symlink', 'file-symlink', 'file-hardlink']) {
      const h = await fixture()
      if (mutation === 'directory-symlink') {
        await rename(h.directoryPath, `${h.directoryPath}.target`)
        await symlink(`${h.directoryPath}.target`, h.directoryPath)
      } else if (mutation === 'file-symlink') {
        await rename(h.file, `${h.file}.target`)
        await symlink(`${h.file}.target`, h.file)
      } else await link(h.file, `${h.file}.link`)
      await expectUnavailable(reader(h.policy).read())
    }
  })

  it('rejects a non-regular, missing, empty, or oversized file', async () => {
    for (const mutation of ['directory', 'missing', 'empty', 'oversized']) {
      const h = await fixture()
      await rename(h.file, `${h.file}.original`)
      if (mutation === 'directory') await mkdir(h.file, { mode: 0o444 })
      else if (mutation !== 'missing') {
        const contents = mutation === 'empty' ? new Uint8Array() : new Uint8Array(D1_CORE_ENV_MAX_BYTES + 1)
        await writeFile(h.file, contents, { mode: 0o444 })
      }
      await expectUnavailable(reader(h.policy).read())
    }
  })

  it('snapshots policy and rejects hostile policy without leaking its canary', async () => {
    const h = await fixture()
    const mutable = { ...h.policy }
    const authorityReader = reader(mutable)
    mutable.directoryPath = `${h.directoryPath}-${CANARY}`
    mutable.fileMode = 0o600
    expect(await authorityReader.read()).toEqual(VALUES)

    const hostile = new Proxy(h.policy, {
      get() { throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: CANARY }) },
    })
    expectUnavailableSync(() => reader(hostile))
    for (const directoryPath of ['relative', `${h.directoryPath}/`, `${h.directoryPath}\0${CANARY}`]) {
      expectUnavailableSync(() => reader({ ...h.policy, directoryPath }))
    }
  })

  it('has no writer API and uses anchored no-follow descriptors', async () => {
    const source = await readFile(new URL('../d1CoreEnvAuthority.ts', import.meta.url), 'utf8')
    expect(source).toContain('/proc/self/fd/')
    expect(source).toContain('O_NOFOLLOW')
    expect(source).toContain('O_NONBLOCK')
    expect(source).toContain("parseEnv(content)")
    expect(source).not.toMatch(/writeFile|rename|unlink|createWriteStream|process\.env|COMPOSIO_API_KEY/)
  })
})
