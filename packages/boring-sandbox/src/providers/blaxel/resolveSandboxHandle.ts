import { createHash } from 'node:crypto'

import type { SandboxHandleRecord, SandboxHandleStore } from '@hachej/boring-agent/shared'

import type { BlaxelClient, BlaxelRemoteSandbox } from './client'
import type { ResolvedBlaxelConfig } from './config'
import { isBlaxelNotFound, isBlaxelTransient, normalizeBlaxelError } from './errors'

function digest(workspaceId: string): string {
  return createHash('sha256').update(workspaceId).digest('hex').slice(0, 32)
}

export function blaxelSandboxName(workspaceId: string): string { return `boring-${digest(workspaceId)}` }
export function blaxelVolumeName(workspaceId: string): string { return `boring-vol-${digest(workspaceId)}` }
export function blaxelExternalId(workspaceId: string): string { return `boring-workspace-${digest(workspaceId)}` }

async function getSandboxWithOneRetry(client: BlaxelClient, name: string): Promise<BlaxelRemoteSandbox> {
  try { return await client.getSandbox(name) }
  catch (error) {
    if (!isBlaxelTransient(error)) throw error
    return await client.getSandbox(name)
  }
}

async function waitForVolumeAvailable(client: BlaxelClient, name: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let attachedTo
    try { attachedTo = await client.getVolumeAttachment(name) }
    catch (error) { throw normalizeBlaxelError(error) }
    if (!attachedTo) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw normalizeBlaxelError(new Error('persistent Volume is still attached'), 'BLAXEL_VOLUME_BUSY')
}

function assertCompatible(
  remote: BlaxelRemoteSandbox,
  config: ResolvedBlaxelConfig,
  expectedName: string,
  expectedExternalId: string,
  volumeName: string,
): void {
  const runtime = remote.spec.runtime
  const attachment = remote.spec.volumes?.find((volume) => volume.mountPath === config.workspaceRoot)
  const mismatch = remote.name !== expectedName
    || remote.externalId !== expectedExternalId
    || remote.spec.region !== config.region
    || runtime?.image !== config.image
    || runtime?.memory !== config.memoryMb
    || (config.volume.enabled && (attachment?.name !== volumeName || attachment.readOnly === true))
    || (!config.volume.enabled && (remote.spec.volumes?.length ?? 0) > 0)
  if (mismatch) {
    throw normalizeBlaxelError(new Error('existing sandbox configuration does not match requested region, image, memory, or Volume'), 'BLAXEL_CONFIG_DRIFT')
  }
}

function isReusableSandbox(remote: BlaxelRemoteSandbox): boolean {
  return !/failed|terminated|terminating|deleting|deactivating|deleted/i.test(remote.status ?? '')
}

function isDyingSandbox(remote: BlaxelRemoteSandbox): boolean {
  return /terminating|deleting|deactivating/i.test(remote.status ?? '')
}

async function waitForSandboxRecoveryState(
  client: BlaxelClient,
  name: string,
): Promise<BlaxelRemoteSandbox | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const current = await client.getSandbox(name)
      if (isReusableSandbox(current)) return current
      if (!isDyingSandbox(current)) return undefined
    } catch (error) {
      if (isBlaxelNotFound(error)) return undefined
      throw normalizeBlaxelError(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw normalizeBlaxelError(new Error('terminal sandbox has not released its durable resources'), 'BLAXEL_VOLUME_BUSY')
}

function record(workspaceId: string, name: string, previous: SandboxHandleRecord | null, now: Date): SandboxHandleRecord {
  return {
    workspaceId,
    sandboxId: name,
    createdAt: previous?.createdAt ?? now.toISOString(),
    lastUsedAt: now.toISOString(),
  }
}

interface ResolveInput {
  workspaceId: string
  store: SandboxHandleStore
  client: BlaxelClient
  config: ResolvedBlaxelConfig
  now?: () => Date
}

export function createBlaxelSandboxHandleResolver() {
  const cache = new Map<string, BlaxelRemoteSandbox>()
  const inFlight = new Map<string, Promise<BlaxelRemoteSandbox>>()
  const generations = new Map<string, number>()

  async function resolve(input: ResolveInput): Promise<BlaxelRemoteSandbox> {
    const workspaceId = input.workspaceId.trim()
    if (!workspaceId) throw new Error('workspaceId must not be empty')
    const sandboxName = blaxelSandboxName(workspaceId)
    const externalId = blaxelExternalId(workspaceId)
    const volumeName = blaxelVolumeName(workspaceId)
    const pending = inFlight.get(workspaceId)
    if (pending) return await pending
    const cached = cache.get(workspaceId)
    if (cached) {
      const generation = generations.get(workspaceId) ?? 0
      const previous = await input.store.get(workspaceId)
      if (previous?.sandboxId && previous.sandboxId !== sandboxName) {
        throw normalizeBlaxelError(new Error('stored sandbox name does not match the workspace binding'), 'BLAXEL_CONFIG_DRIFT')
      }
      assertCompatible(cached, input.config, sandboxName, externalId, volumeName)
      if (isReusableSandbox(cached)) {
        if ((generations.get(workspaceId) ?? 0) !== generation) {
          return await resolve(input)
        }
        await input.store.put(record(workspaceId, cached.name, previous, (input.now ?? (() => new Date()))()))
        if ((generations.get(workspaceId) ?? 0) !== generation) {
          cache.delete(workspaceId)
          return await resolve(input)
        }
        return cached
      }
      cache.delete(workspaceId)
    }
    if (!generations.has(workspaceId)) generations.set(workspaceId, 0)
    const generation = generations.get(workspaceId) ?? 0

    const resolution = (async () => {
      const previous = await input.store.get(workspaceId)
      if (previous?.sandboxId && previous.sandboxId !== sandboxName) {
        throw normalizeBlaxelError(new Error('stored sandbox name does not match the workspace binding'), 'BLAXEL_CONFIG_DRIFT')
      }
      let remote: BlaxelRemoteSandbox | undefined
      const lookupName = previous?.sandboxId ?? sandboxName
      try {
        remote = await getSandboxWithOneRetry(input.client, lookupName)
      } catch (error) {
        if (!isBlaxelNotFound(error)) throw normalizeBlaxelError(error)
        if (previous?.sandboxId && !input.config.volume.enabled) {
          throw normalizeBlaxelError(new Error('stored sandbox expired without durable Volume'), 'SANDBOX_EXPIRED')
        }
      }
      if (remote) {
        try {
          assertCompatible(remote, input.config, sandboxName, externalId, volumeName)
        } catch (error) {
          throw normalizeBlaxelError(error, 'BLAXEL_CONFIG_DRIFT')
        }
        if (!isReusableSandbox(remote)) {
          if (!input.config.volume.enabled) {
            throw normalizeBlaxelError(new Error('stored sandbox terminated without durable Volume'), 'SANDBOX_EXPIRED')
          }
          remote = await waitForSandboxRecoveryState(input.client, remote.name)
        }
      }

      if (input.config.volume.enabled) {
        let volume
        try { volume = await input.client.getVolume(volumeName) }
        catch (error) {
          if (!isBlaxelNotFound(error)) throw normalizeBlaxelError(error)
          try {
            volume = await input.client.createVolume({
              name: volumeName,
              size: input.config.volume.sizeMb,
              region: input.config.region,
            })
          } catch (createError) { throw normalizeBlaxelError(createError) }
        }
        if (volume.spec.region !== input.config.region || volume.spec.size !== input.config.volume.sizeMb) {
          throw normalizeBlaxelError(new Error('existing Volume configuration does not match requested region or size'), 'BLAXEL_CONFIG_DRIFT')
        }
        if (!remote) await waitForVolumeAvailable(input.client, volumeName)
      }

      if (!remote) {
        try {
          remote = await input.client.createSandbox({
            name: sandboxName,
            externalId,
            image: input.config.image,
            memory: input.config.memoryMb,
            region: input.config.region,
            ttl: input.config.ttl,
            lifecycle: input.config.lifecycle,
            labels: { owner: 'boring-ui', workspace: digest(workspaceId) },
            volumes: input.config.volume.enabled
              ? [{ name: volumeName, mountPath: input.config.workspaceRoot, readOnly: false }]
              : undefined,
          })
        } catch (error) { throw normalizeBlaxelError(error) }
        if (!isReusableSandbox(remote)) {
          throw normalizeBlaxelError(new Error('Blaxel create returned a non-reusable sandbox'), 'BLAXEL_VOLUME_BUSY')
        }
      }
      assertCompatible(remote, input.config, sandboxName, externalId, volumeName)
      if ((generations.get(workspaceId) ?? 0) === generation) {
        await input.store.put(record(workspaceId, remote.name, previous, (input.now ?? (() => new Date()))()))
        cache.set(workspaceId, remote)
      }
      return remote
    })()
    inFlight.set(workspaceId, resolution)
    try { return await resolution } finally {
      if (inFlight.get(workspaceId) === resolution) inFlight.delete(workspaceId)
    }
  }

  function invalidate(workspaceId: string): void {
    cache.delete(workspaceId)
    inFlight.delete(workspaceId)
    generations.set(workspaceId, (generations.get(workspaceId) ?? 0) + 1)
  }

  function clear(): void {
    cache.clear()
    inFlight.clear()
    for (const workspaceId of generations.keys()) invalidate(workspaceId)
  }

  return { resolve, invalidate, clear }
}
