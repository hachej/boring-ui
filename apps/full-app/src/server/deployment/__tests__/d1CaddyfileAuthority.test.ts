import { link, mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createD1CaddyfileAuthorityReaderForPolicy,
  D1_CADDYFILE_AUTHORITY_POLICY,
  D1_CADDYFILE_MAX_BYTES,
  D1_CADDYFILE_PATH,
  type D1CaddyfileAuthorityPolicy,
} from '../d1CaddyfileAuthority.js'
import { D1HostError, D1HostErrorCode } from '../d1Plan.js'

const UID = process.geteuid!()
const GID = process.getegid!()
const CANARY = 'caddy-authority-canary-never-leaks'
const CONTENT = new TextEncoder().encode('example.test {\n  reverse_proxy core-app:3000\n}\n')

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-caddy-authority-'))
  const directoryPath = path.join(parent, 'd1')
  await mkdir(directoryPath, { mode: 0o755 })
  const file = path.join(directoryPath, 'Caddyfile')
  await writeFile(file, CONTENT, { mode: 0o444 })
  const policy: D1CaddyfileAuthorityPolicy = {
    directoryPath,
    directoryUid: UID,
    directoryGid: GID,
    directoryMode: 0o755,
    fileUid: UID,
    fileGid: GID,
    fileMode: 0o444,
    maxBytes: D1_CADDYFILE_MAX_BYTES,
  }
  return { directoryPath, file, policy }
}

function reader(policy: D1CaddyfileAuthorityPolicy) {
  return createD1CaddyfileAuthorityReaderForPolicy(policy)
}

async function expectUnavailable(action: Promise<unknown>): Promise<void> {
  const failure = await action.catch((error) => error)
  expect(failure).toEqual(expect.objectContaining({
    code: D1HostErrorCode.COLLECTION_NOT_READY,
    details: { field: 'caddyfile' },
  }))
  expect(JSON.stringify(failure)).not.toMatch(new RegExp(`${CANARY}|boring-d1-caddy-authority-|Caddyfile`))
}

function expectUnavailableSync(action: () => unknown): void {
  let failure: unknown
  try { action() } catch (error) { failure = error }
  expect(failure).toEqual(expect.objectContaining({
    code: D1HostErrorCode.COLLECTION_NOT_READY,
    details: { field: 'caddyfile' },
  }))
  expect(JSON.stringify(failure)).not.toContain(CANARY)
}

describe('D1 Caddyfile authority', () => {
  it('reads detached bytes through a descriptor-anchored reader', async () => {
    const h = await fixture()
    const authorityReader = reader(h.policy)
    const first = await authorityReader.read()
    first[0] = 0
    const second = await authorityReader.read()
    expect(second).toEqual(CONTENT)
    expect(first).not.toEqual(second)
    expect(Object.isFrozen(authorityReader)).toBe(true)
  })

  it('hard-codes the production path and root-owned immutable policy', () => {
    expect(D1_CADDYFILE_PATH).toBe('/opt/boring/d1/Caddyfile')
    expect(D1_CADDYFILE_AUTHORITY_POLICY).toEqual({
      directoryPath: '/opt/boring/d1',
      directoryUid: 0,
      directoryGid: 0,
      directoryMode: 0o755,
      fileUid: 0,
      fileGid: 0,
      fileMode: 0o444,
      maxBytes: 64 * 1024,
    })
    expect(Object.isFrozen(D1_CADDYFILE_AUTHORITY_POLICY)).toBe(true)
  })

  it.each([
    ['directory owner', (p: D1CaddyfileAuthorityPolicy) => ({ ...p, directoryUid: p.directoryUid + 1 })],
    ['directory group', (p: D1CaddyfileAuthorityPolicy) => ({ ...p, directoryGid: p.directoryGid + 1 })],
    ['directory mode', (p: D1CaddyfileAuthorityPolicy) => ({ ...p, directoryMode: 0o750 })],
    ['file owner', (p: D1CaddyfileAuthorityPolicy) => ({ ...p, fileUid: p.fileUid + 1 })],
    ['file group', (p: D1CaddyfileAuthorityPolicy) => ({ ...p, fileGid: p.fileGid + 1 })],
    ['file mode', (p: D1CaddyfileAuthorityPolicy) => ({ ...p, fileMode: 0o440 })],
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
        const contents = mutation === 'empty' ? new Uint8Array() : new Uint8Array(D1_CADDYFILE_MAX_BYTES + 1)
        await writeFile(h.file, contents, { mode: 0o444 })
      }
      await expectUnavailable(reader(h.policy).read())
    }
  })

  it('snapshots policy and ignores later caller mutation', async () => {
    const h = await fixture()
    const mutablePolicy = { ...h.policy }
    const authorityReader = reader(mutablePolicy)
    mutablePolicy.directoryPath = `${h.directoryPath}-${CANARY}`
    mutablePolicy.fileMode = 0o600
    expect(await authorityReader.read()).toEqual(CONTENT)
  })

  it('rejects noncanonical and hostile policy without leaking canaries', async () => {
    const h = await fixture()
    for (const directoryPath of ['relative', `${h.directoryPath}/`, `${h.directoryPath}\0${CANARY}`]) {
      expectUnavailableSync(() => reader({ ...h.policy, directoryPath }))
    }
    const hostile = new Proxy(h.policy, {
      get() {
        throw new D1HostError(D1HostErrorCode.COLLECTION_NOT_READY, { field: CANARY })
      },
    })
    expectUnavailableSync(() => reader(hostile))
  })

  it('suppresses file contents and paths when filesystem validation fails', async () => {
    const h = await fixture()
    await rename(h.file, `${h.file}.${CANARY}`)
    await writeFile(h.file, CANARY, { mode: 0o400 })
    await expectUnavailable(reader(h.policy).read())
  })

  it('has no writer API and reads only through anchored no-follow descriptors', async () => {
    const source = await readFile(new URL('../d1CaddyfileAuthority.ts', import.meta.url), 'utf8')
    expect(source).toContain('/proc/self/fd/')
    expect(source).toContain('O_NOFOLLOW')
    expect(source).toContain('O_NONBLOCK')
    expect(source).not.toMatch(/writeFile|rename|unlink|createWriteStream|process\.env/)
  })
})
