import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, link, open, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  createDefaultAgentHostAuthority,
  openAgentHostAuthorityDescriptor,
  parseAgentHostIsolatedAuthorityDescriptor,
  readAgentHostAuthorityDatabaseUrl,
  type AgentHostAuthorityCapability,
} from '../agentHostAuthority.js'
import { createAgentHostAuthorityRootPublicationClient } from '../agentHostPublicationControl.js'
import { createAgentHostAuthorityBindingSecretMaterializer } from '../agentHostSecretMaterializer.js'
import { AgentHostErrorCode } from '../agentHostPlan.js'
import {
  AGENT_HOST_AUTHORITY_TEST_HOST as HOST,
  AGENT_HOST_AUTHORITY_TEST_PROJECT as PROJECT,
  AGENT_HOST_AUTHORITY_TEST_UID as UID,
  createAgentHostAuthorityFixture as fixture,
} from './agentHostAuthorityFixture.js'

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

  it('rejects forged capability objects at materialization and recovery construction seams', async () => {
    const value = await fixture(); const forged = structuredClone(value.descriptor) as AgentHostAuthorityCapability
    expect(() => createAgentHostAuthorityBindingSecretMaterializer(forged, {
      ownerUid: UID, appUid: 10001, appGid: 10001, provider: {} as never,
    })).toThrowError(expect.objectContaining({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'authority' } }))
    expect(() => createAgentHostAuthorityRootPublicationClient(forged, {
      appGid: 10001, operationId: 'operation', revisionStore: {} as never,
    })).toThrowError(expect.objectContaining({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'authority' } }))
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
    expect(await readAgentHostAuthorityDatabaseUrl(value.authority)).toMatch(/^postgresql:/)
    await link(value.databaseUrlFile, path.join(value.authorityRoot, 'database-alias'))
    await expect(readAgentHostAuthorityDatabaseUrl(value.authority)).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'databaseAuthority' } })
    const normal = await fixture()
    await chmod(normal.databaseUrlFile, 0o600)
    const handle = await open(normal.databaseUrlFile, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW)
    await handle.writeFile('postgresql://normal:canary@127.0.0.1:5432/normal\n'); await handle.close(); await chmod(normal.databaseUrlFile, 0o400)
    await expect(readAgentHostAuthorityDatabaseUrl(normal.authority)).rejects.toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'databaseAuthority' } })
  })

  it('returns stable generic errors without secret or raw-path output', async () => {
    const value = await fixture(); await chmod(value.databaseUrlFile, 0o644)
    const error = await readAgentHostAuthorityDatabaseUrl(value.authority).catch((caught) => caught)
    expect(error).toMatchObject({ code: AgentHostErrorCode.PLAN_INVALID, details: { field: 'databaseAuthority' } })
    expect(JSON.stringify(error)).not.toMatch(/canary|postgresql|agent-host-proof-authority-|database-url/)
  })
})
