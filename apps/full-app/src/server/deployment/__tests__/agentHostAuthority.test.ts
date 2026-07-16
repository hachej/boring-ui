import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, link, mkdir, mkdtemp, open, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  createDefaultAgentHostAuthority,
  openAgentHostAuthorityDescriptor,
  parseAgentHostIsolatedAuthorityDescriptor,
  readAgentHostAuthorityDatabaseUrl,
} from '../agentHostAuthority.js'
import { AgentHostErrorCode } from '../agentHostPlan.js'

const UID = process.geteuid!()
const HOST = 'agent-host-proof-eu'
const PROJECT = 'agent-host-proof-seneca'
const DATABASE = 'agent_host_proof_seneca'

async function fixture() {
  const authorityRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-host-proof-authority-'))
  await chmod(authorityRoot, 0o700)
  const roots = Object.fromEntries(['config', 'state', 'materialized', 'control', 'locks', 'secrets', 'workspaces', 'sessions'].map((name) => [name, path.join(authorityRoot, name)])) as Record<string, string>
  for (const root of Object.values(roots)) { await mkdir(root, { mode: 0o700 }); await chmod(root, 0o700) }
  for (const name of ['compose.yml', 'compose.isolated.yml', 'Caddyfile']) await writeFile(path.join(roots.config!, name), `${name}\n`, { mode: 0o400 })
  await writeFile(path.join(roots.config!, 'core.env'), 'redacted=config\n', { mode: 0o400 }); await chmod(path.join(roots.config!, 'core.env'), 0o400)
  const secretRoot = roots.secrets!
  const databaseUrlFile = path.join(secretRoot, 'database-url')
  await writeFile(databaseUrlFile, `postgresql://${DATABASE}:canary@127.0.0.1:5432/${DATABASE}\n`, { mode: 0o400 }); await chmod(databaseUrlFile, 0o400)
  const descriptor = {
    schemaVersion: 1, domain: 'boring-agent-host-authority:v1', mode: 'isolated-proof', authorityRoot, hostId: HOST,
    operatorUid: UID, composeProject: PROJECT, configRoot: roots.config, stateRoot: roots.state, materializedRoot: roots.materialized,
    controlRoot: roots.control, lockRoot: roots.locks, secretRoot, workspaceRoot: roots.workspaces, sessionRoot: roots.sessions,
    databaseUrlFile, databaseRef: DATABASE,
    runtimeProfile: { ref: 'runsc-eu', id: 'runsc', launcher: 'docker-runsc', privilegeModel: 'docker-runsc-nonroot', composeRuntime: 'runsc' },
  } as const
  const descriptorFile = path.join(authorityRoot, 'authority.json')
  await writeFile(descriptorFile, `${JSON.stringify(descriptor)}\n`, { mode: 0o400 }); await chmod(descriptorFile, 0o400)
  return { authorityRoot, roots, descriptor, descriptorFile, databaseUrlFile }
}

function rejection(value: unknown) {
  expect(() => parseAgentHostIsolatedAuthorityDescriptor(value, HOST)).toThrowError(expect.objectContaining({
    code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'authority' },
  }))
}

describe('AgentHost authority descriptor', () => {
  it('keeps the production authority defaults byte-for-byte stable', () => {
    expect(createDefaultAgentHostAuthority({ hostId: 'eu-host-1', operatorUid: UID, stateRoot: '/var/lib/boring/agent-host', lockRoot: '/run/boring/agent-host/locks' })).toEqual({
      schemaVersion: 1, domain: 'boring-agent-host-authority:v1', mode: 'production', hostId: 'eu-host-1', operatorUid: UID,
      composeProject: 'boring-agent-host', configRoot: '/opt/boring/agent-host', stateRoot: '/var/lib/boring/agent-host',
      materializedRoot: '/run/boring/agent-host', controlRoot: '/run/boring/agent-host/control', lockRoot: '/run/boring/agent-host/locks',
      secretRoot: '/run/boring/agent-host/eu-host-1/host-secrets', workspaceRoot: 'agent-host-workspaces', sessionRoot: 'agent-host-sessions',
      databaseUrlFile: '/run/boring/agent-host/eu-host-1/host-secrets/database-url', databaseRef: null, runtimeProfile: null,
    })
  })

  it('accepts only one canonical exact-key isolated descriptor through a protected no-follow file', async () => {
    const value = await fixture(); const opened = await openAgentHostAuthorityDescriptor(value.descriptorFile, HOST)
    try { expect(opened.authority).toEqual(value.descriptor) } finally { await opened.handle.close() }
    const noncanonical = path.join(value.authorityRoot, 'noncanonical.json')
    await writeFile(noncanonical, JSON.stringify(value.descriptor, null, 2), { mode: 0o400 }); await chmod(noncanonical, 0o400)
    await expect(openAgentHostAuthorityDescriptor(noncanonical, HOST)).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'authority' } })
  })

  it('revalidates the same inherited descriptor handle without depending on its shared file offset', async () => {
    const value = await fixture(); const opened = await openAgentHostAuthorityDescriptor(value.descriptorFile, HOST)
    const moduleUrl = pathToFileURL(path.resolve('src/server/deployment/agentHostAuthority.ts')).href
    const source = `import {readInheritedAgentHostAuthorityDescriptor as read} from ${JSON.stringify(moduleUrl)};const value=await read(4,process.env.AUTHORITY_FILE,${JSON.stringify(HOST)});process.stdout.write(JSON.stringify({project:value.composeProject})+'\\n')`
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      env: { ...process.env, AUTHORITY_FILE: value.descriptorFile }, stdio: ['ignore', 'pipe', 'pipe', 'ignore', opened.handle.fd],
    })
    const stdout: Buffer[] = []; child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk))
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    await opened.handle.close()
    expect({ code, output: Buffer.concat(stdout).toString('utf8') }).toEqual({ code: 0, output: `${JSON.stringify({ project: PROJECT })}\n` })
  })

  it('rejects normal project/root/database, overlap, host drift, runtime downgrade, and extra keys', async () => {
    const { descriptor } = await fixture()
    for (const changed of [
      { ...descriptor, composeProject: 'boring-agent-host' },
      { ...descriptor, stateRoot: '/var/lib/boring/agent-host' },
      { ...descriptor, databaseRef: 'boring' },
      { ...descriptor, hostId: 'normal-host' },
      { ...descriptor, sessionRoot: descriptor.workspaceRoot },
      { ...descriptor, runtimeProfile: { ...descriptor.runtimeProfile, composeRuntime: 'runc' } },
      { ...descriptor, unexpected: true },
    ]) rejection(changed)
  })

  it('rejects symlinked and oversized descriptor files before parsing', async () => {
    const value = await fixture(); const alias = path.join(value.authorityRoot, 'authority-link.json')
    await symlink(value.descriptorFile, alias)
    await expect(openAgentHostAuthorityDescriptor(alias, HOST)).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID })
    const oversized = path.join(value.authorityRoot, 'authority-oversized.json')
    await writeFile(oversized, 'x'.repeat(64 * 1024 + 1), { mode: 0o400 }); await chmod(oversized, 0o400)
    await expect(openAgentHostAuthorityDescriptor(oversized, HOST)).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID })
  })

  it('rejects a hard-linked descriptor and reads only the descriptor-bound isolated database file', async () => {
    const value = await fixture(); const alias = path.join(value.authorityRoot, 'authority-alias.json')
    await link(value.descriptorFile, alias)
    await expect(openAgentHostAuthorityDescriptor(value.descriptorFile, HOST)).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID })
    const parsed = parseAgentHostIsolatedAuthorityDescriptor(value.descriptor, HOST)
    expect(await readAgentHostAuthorityDatabaseUrl(parsed)).toMatch(/^postgresql:/)
    await link(value.databaseUrlFile, path.join(value.authorityRoot, 'database-alias'))
    await expect(readAgentHostAuthorityDatabaseUrl(parsed)).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'databaseAuthority' } })
    const normal = await fixture(); const normalAuthority = parseAgentHostIsolatedAuthorityDescriptor(normal.descriptor, HOST)
    await chmod(normal.databaseUrlFile, 0o600)
    const handle = await open(normal.databaseUrlFile, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW)
    await handle.writeFile('postgresql://normal:canary@127.0.0.1:5432/normal\n'); await handle.close(); await chmod(normal.databaseUrlFile, 0o400)
    await expect(readAgentHostAuthorityDatabaseUrl(normalAuthority)).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'databaseAuthority' } })
  })

  it('returns stable generic errors without secret or raw-path output', async () => {
    const value = await fixture(); await chmod(value.databaseUrlFile, 0o644)
    const error = await readAgentHostAuthorityDatabaseUrl(parseAgentHostIsolatedAuthorityDescriptor(value.descriptor, HOST)).catch((caught) => caught)
    expect(error).toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'databaseAuthority' } })
    expect(JSON.stringify(error)).not.toMatch(/canary|postgresql|agent-host-proof-authority-|database-url/)
  })
})
