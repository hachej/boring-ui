import { execFile } from 'node:child_process'
import { chmod, link, mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  createD1ApprovedHostReleaseFileReaderForPolicy,
  D1_APPROVED_HOST_RELEASE_AUTHORITY_POLICY,
  D1_APPROVED_HOST_RELEASE_MAX_BYTES,
  D1_APPROVED_HOST_RELEASE_ROOT,
  type D1ApprovedHostReleaseFilePolicy,
} from '../approvedHostReleaseFile.js'
import { D1HostErrorCode } from '../d1Plan.js'

const run = promisify(execFile)
const UID = process.geteuid!()
const GID = process.getegid!()
const HOST_ID = 'eu-host-1'
const CANARY = 'authority-file-canary-never-leaks'
const digest = (character: string) => `sha256:${character.repeat(64)}`
const revision = (character: string) => character.repeat(40)

const release = () => ({
  schemaVersion: 1,
  domain: 'boring-d1-approved-host-release:v1',
  hostAppImageDigest: digest('a'),
  coreCommand: { entrypoint: ['/usr/local/bin/web-entrypoint'], cmd: ['node', 'apps/full-app/dist/server/main.js'] },
  migrationProcess: { entrypoint: ['node'], cmd: ['apps/full-app/dist/server/migrate.js'], user: '10001:10001',
    readonlyRootfs: true, privileged: false, noNewPrivileges: true, addedCapabilities: [] },
  ingressImageDigest: digest('b'),
  ingressCommand: { entrypoint: null, cmd: ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'] },
  caddyfileDigest: digest('c'),
  hostSecurityConfigDigest: digest('d'),
  selectorInventoryRevision: revision('a'),
  executionPolicyRevision: revision('b'),
  databaseSchemaCompatibility: { migrationSetDigest: digest('e'), currentEpoch: 2,
    readableEpochRange: { min: 1, max: 2 }, readableByPreviousRelease: true },
})

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'boring-d1-approved-release-'))
  const directoryPath = path.join(parent, 'approved-host-releases')
  await mkdir(directoryPath, { mode: 0o755 })
  const file = path.join(directoryPath, `${HOST_ID}.json`)
  await writeFile(file, JSON.stringify(release()), { mode: 0o444 })
  const policy: D1ApprovedHostReleaseFilePolicy = {
    directoryPath, directoryUid: UID, directoryGid: GID, directoryMode: 0o755,
    fileUid: UID, fileGid: GID, fileMode: 0o444, maxBytes: D1_APPROVED_HOST_RELEASE_MAX_BYTES,
  }
  return { directoryPath, file, policy }
}

function reader(policy: D1ApprovedHostReleaseFilePolicy) {
  return createD1ApprovedHostReleaseFileReaderForPolicy(policy)
}

function deeplyFrozen(value: unknown): boolean {
  return !value || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
}

async function expectUnavailable(action: Promise<unknown>): Promise<void> {
  const failure = await action.catch((error) => error)
  expect(failure).toMatchObject({
    code: D1HostErrorCode.COLLECTION_NOT_READY,
    details: { field: 'approvedHostRelease' },
  })
  expect(JSON.stringify(failure)).not.toMatch(new RegExp(`${CANARY}|approved-release-|approved-host-releases|eu-host-1\\.json`))
}

describe('D1 approved host release authority file', () => {
  it('reads one descriptor-anchored, deeply frozen approved record', async () => {
    const h = await fixture()
    const record = await reader(h.policy).read(HOST_ID)
    expect(record).toEqual(release())
    expect(deeplyFrozen(record)).toBe(true)
  })

  it('hard-codes the production root and root-owned immutable metadata policy', () => {
    expect(D1_APPROVED_HOST_RELEASE_ROOT).toBe('/etc/boring/d1/approved-host-releases')
    expect(D1_APPROVED_HOST_RELEASE_AUTHORITY_POLICY).toEqual({
      directoryPath: '/etc/boring/d1/approved-host-releases',
      directoryUid: 0, directoryGid: 0, directoryMode: 0o755,
      fileUid: 0, fileGid: 0, fileMode: 0o444, maxBytes: 64 * 1024,
    })
    expect(Object.isFrozen(D1_APPROVED_HOST_RELEASE_AUTHORITY_POLICY)).toBe(true)
  })

  it.each([
    ['directory owner', (p: D1ApprovedHostReleaseFilePolicy) => ({ ...p, directoryUid: p.directoryUid + 1 })],
    ['directory group', (p: D1ApprovedHostReleaseFilePolicy) => ({ ...p, directoryGid: p.directoryGid + 1 })],
    ['directory mode', (p: D1ApprovedHostReleaseFilePolicy) => ({ ...p, directoryMode: 0o750 })],
    ['file owner', (p: D1ApprovedHostReleaseFilePolicy) => ({ ...p, fileUid: p.fileUid + 1 })],
    ['file group', (p: D1ApprovedHostReleaseFilePolicy) => ({ ...p, fileGid: p.fileGid + 1 })],
    ['file mode', (p: D1ApprovedHostReleaseFilePolicy) => ({ ...p, fileMode: 0o440 })],
  ])('rejects wrong %s metadata', async (_name, mutate) => {
    const h = await fixture()
    await expectUnavailable(reader(mutate(h.policy)).read(HOST_ID))
  })

  it('rejects a symlinked authority directory and symlinked or hard-linked record', async () => {
    for (const mutation of ['directory-symlink', 'file-symlink', 'file-hardlink']) {
      const h = await fixture()
      if (mutation === 'directory-symlink') {
        await rename(h.directoryPath, `${h.directoryPath}.target`)
        await symlink(`${h.directoryPath}.target`, h.directoryPath)
      } else if (mutation === 'file-symlink') {
        await rename(h.file, `${h.file}.target`)
        await symlink(`${h.file}.target`, h.file)
      } else await link(h.file, `${h.file}.link`)
      await expectUnavailable(reader(h.policy).read(HOST_ID))
    }
  })

  it('rejects a FIFO without blocking', async () => {
    const h = await fixture()
    await rename(h.file, `${h.file}.original`)
    await run('mkfifo', [h.file])
    await chmod(h.file, 0o444)
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('FIFO open blocked')), 500))
    await expectUnavailable(Promise.race([reader(h.policy).read(HOST_ID), timeout]))
  })

  it('rejects missing, empty, oversized, malformed, invalid UTF-8, and drifted records', async () => {
    for (const mutation of ['missing', 'empty', 'oversized', 'malformed', 'utf8', 'drift']) {
      const h = await fixture()
      await chmod(h.file, 0o600)
      if (mutation === 'missing') await rename(h.file, `${h.file}.missing`)
      else if (mutation === 'empty') await writeFile(h.file, '')
      else if (mutation === 'oversized') await writeFile(h.file, new Uint8Array(D1_APPROVED_HOST_RELEASE_MAX_BYTES + 1))
      else if (mutation === 'malformed') await writeFile(h.file, `{ "${CANARY}":`)
      else if (mutation === 'utf8') await writeFile(h.file, new Uint8Array([0xc3, 0x28]))
      else await writeFile(h.file, JSON.stringify({ ...release(), hostAppImageDigest: CANARY }))
      if (mutation !== 'missing') await chmod(h.file, 0o444)
      await expectUnavailable(reader(h.policy).read(HOST_ID))
    }
  })

  it('rejects noncanonical policy and host-id input without exposing their values', async () => {
    const h = await fixture()
    for (const directoryPath of ['relative', `${h.directoryPath}/`, `${h.directoryPath}\0${CANARY}`]) {
      expect(() => reader({ ...h.policy, directoryPath })).toThrow(expect.objectContaining({
        code: D1HostErrorCode.COLLECTION_NOT_READY, details: { field: 'approvedHostRelease' },
      }))
    }
    await expectUnavailable(reader(h.policy).read(`../${CANARY}`))
  })

  it('has no writer API and only reads the record through anchored descriptors', async () => {
    const source = await readFile(new URL('../approvedHostReleaseFile.ts', import.meta.url), 'utf8')
    expect(source).toContain('/proc/self/fd/')
    expect(source).toContain('O_NOFOLLOW')
    expect(source).toContain('O_NONBLOCK')
    expect(source).not.toMatch(/writeFile|rename|unlink|createWriteStream|process\.env/)
  })
})
