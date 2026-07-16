import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { openAgentHostAuthorityDescriptor, type AgentHostAuthorityCapability, type AgentHostIsolatedAuthorityDescriptorV1 } from '../agentHostAuthority.js'

export const AGENT_HOST_AUTHORITY_TEST_UID = process.geteuid!()
export const AGENT_HOST_AUTHORITY_TEST_HOST = 'agent-host-proof-eu'
export const AGENT_HOST_AUTHORITY_TEST_PROJECT = 'agent-host-proof-seneca'
export const AGENT_HOST_AUTHORITY_TEST_DATABASE = 'agent_host_proof_seneca'

export async function createAgentHostAuthorityFixture(options: { readonly databaseRef?: string; readonly databaseUrl?: string; readonly parent?: string } = {}): Promise<{
  readonly authorityRoot: string
  readonly roots: Readonly<Record<string, string>>
  readonly descriptor: AgentHostIsolatedAuthorityDescriptorV1
  readonly descriptorFile: string
  readonly databaseUrlFile: string
  readonly authority: AgentHostAuthorityCapability & AgentHostIsolatedAuthorityDescriptorV1
}> {
  const authorityRoot = await mkdtemp(path.join(options.parent ?? os.tmpdir(), 'agent-host-proof-authority-'))
  await chmod(authorityRoot, 0o700)
  const roots = Object.fromEntries(['config', 'state', 'materialized', 'control', 'locks', 'secrets', 'workspaces', 'sessions']
    .map((name) => [name, path.join(authorityRoot, name)])) as Record<string, string>
  for (const root of Object.values(roots)) { await mkdir(root, { mode: 0o700 }); await chmod(root, 0o700) }
  const lockFile = path.join(roots.locks!, `${AGENT_HOST_AUTHORITY_TEST_HOST}.lock`); await writeFile(lockFile, '', { mode: 0o600 }); await chmod(lockFile, 0o600)
  for (const name of ['compose.yml', 'compose.isolated.yml', 'Caddyfile']) await writeFile(path.join(roots.config!, name), `${name}\n`, { mode: 0o400 })
  await writeFile(path.join(roots.config!, 'core.env'), 'redacted=config\n', { mode: 0o400 }); await chmod(path.join(roots.config!, 'core.env'), 0o400)
  const databaseRef = options.databaseRef ?? AGENT_HOST_AUTHORITY_TEST_DATABASE
  const databaseUrlFile = path.join(roots.secrets!, 'database-url')
  await writeFile(databaseUrlFile, `${options.databaseUrl ?? `postgresql://${databaseRef}:canary@127.0.0.1:5432/${databaseRef}`}\n`, { mode: 0o400 })
  await chmod(databaseUrlFile, 0o400)
  const descriptor: AgentHostIsolatedAuthorityDescriptorV1 = {
    schemaVersion: 1, domain: 'boring-agent-host-authority:v1', mode: 'isolated-proof', authorityRoot,
    hostId: AGENT_HOST_AUTHORITY_TEST_HOST, operatorUid: AGENT_HOST_AUTHORITY_TEST_UID,
    composeProject: AGENT_HOST_AUTHORITY_TEST_PROJECT, configRoot: roots.config!, stateRoot: roots.state!, materializedRoot: roots.materialized!,
    controlRoot: roots.control!, lockRoot: roots.locks!, secretRoot: roots.secrets!, workspaceRoot: roots.workspaces!, sessionRoot: roots.sessions!,
    databaseUrlFile, databaseRef,
    runtimeProfile: { ref: 'runsc-eu', id: 'runsc', launcher: 'docker-runsc', privilegeModel: 'docker-runsc-nonroot', composeRuntime: 'runsc' },
  }
  const descriptorFile = path.join(authorityRoot, 'authority.json')
  await writeFile(descriptorFile, `${JSON.stringify(descriptor)}\n`, { mode: 0o400 }); await chmod(descriptorFile, 0o400)
  const opened = await openAgentHostAuthorityDescriptor(descriptorFile, AGENT_HOST_AUTHORITY_TEST_HOST)
  await opened.handle.close()
  return { authorityRoot, roots, descriptor, descriptorFile, databaseUrlFile, authority: opened.authority }
}
