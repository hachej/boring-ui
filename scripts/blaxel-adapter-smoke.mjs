#!/usr/bin/env node

if (!process.env.BL_WORKSPACE || !process.env.BL_API_KEY) {
  console.log('SKIP blaxel-adapter-smoke: BL_WORKSPACE and BL_API_KEY are required')
  process.exit(0)
}

const { SandboxInstance, VolumeInstance, closeConnections, getVolume } = await import('@blaxel/core')
const {
  blaxelSandboxName,
  blaxelVolumeName,
  createBlaxelSandboxProvider,
} = await import('../packages/boring-sandbox/dist/providers/blaxel/index.js')

const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const workspaceId = `live-smoke-${suffix}`
const sandboxName = blaxelSandboxName(workspaceId)
const volumeName = blaxelVolumeName(workspaceId)
const records = new Map()
const store = {
  async get(id) { return records.get(id) ?? null },
  async put(record) { records.set(record.workspaceId, record) },
  async delete(id) { records.delete(id) },
  async list() { return [...records.values()] },
}
const provider = createBlaxelSandboxProvider({
  handleStore: store,
  region: process.env.BORING_BLAXEL_REGION ?? 'eu-fra-1',
  ttl: process.env.BORING_BLAXEL_SMOKE_TTL ?? '30m',
  lifecycle: {
    expirationPolicies: [{ action: 'delete', type: 'ttl-max-age', value: process.env.BORING_BLAXEL_SMOKE_TTL ?? '30m' }],
    terminatedRetention: '5m',
  },
})
const context = { workspaceRoot: '/host/not-used', workspaceId, sessionId: workspaceId }
let cleanupFailed = false

async function waitForVolumeRelease(name) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let response
    try {
      response = await getVolume({ path: { volumeName: name } })
    } catch (error) {
      if (/not found/i.test(safeErrorMessage(error))) return
      throw error
    }
    if (response.error) {
      const status = response.error?.status ?? response.error?.status_code ?? response.error?.code
      if (Number(status) === 404 || /not found/i.test(safeErrorMessage(response.error))) return
      throw response.error
    }
    if (!response.data?.state?.attachedTo) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Volume ${name} did not detach within the cleanup window`)
}

function safeErrorMessage(error) {
  const raw = error instanceof Error
    ? error.message
    : typeof error?.error === 'string' ? error.error
      : typeof error?.message === 'string' ? error.message : 'unknown smoke error'
  return raw
    .replace(/bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/authorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, 'authorization=[redacted]')
    .replace(/([?&]id=)[^\s,;]+/gi, '$1[redacted]')
    .replaceAll(process.env.BL_API_KEY ?? '', '[redacted]')
    .replaceAll(process.env.BL_WORKSPACE ?? '', '[workspace]')
}

try {
  let pair = await provider.create(context)
  if (records.get(workspaceId)?.sandboxId !== sandboxName) throw new Error('adapter did not persist its deterministic sandbox name')
  const liveSandbox = await SandboxInstance.get(sandboxName)
  if (liveSandbox.spec.region !== (process.env.BORING_BLAXEL_REGION ?? 'eu-fra-1')) throw new Error('sandbox region pin mismatch')
  if (liveSandbox.spec.runtime?.image !== (process.env.BORING_BLAXEL_IMAGE ?? 'blaxel/base-image:latest')) throw new Error('sandbox image mismatch')
  if (liveSandbox.spec.runtime?.memory !== Number(process.env.BORING_BLAXEL_MEMORY_MB ?? 4096)) throw new Error('sandbox memory mismatch')
  if (liveSandbox.spec.runtime?.ttl !== (process.env.BORING_BLAXEL_SMOKE_TTL ?? '30m')) throw new Error('sandbox TTL cleanup backstop mismatch')
  if (liveSandbox.spec.lifecycle?.expirationPolicies?.[0]?.type !== 'ttl-max-age') throw new Error('sandbox lifecycle cleanup backstop mismatch')
  const volumeState = await getVolume({ path: { volumeName } })
  if (volumeState.error) throw volumeState.error
  if (volumeState.data?.state?.attachedTo !== `sandbox:${sandboxName}`) throw new Error('Volume attachment mismatch')

  await pair.workspace.unlink('.').then(
    () => { throw new Error('workspace root deletion unexpectedly succeeded') },
    (error) => { if (error?.code !== 'EPERM') throw error },
  )

  await pair.workspace.mkdir('quoted dir/nested', { recursive: true })
  await pair.workspace.writeFile("quoted dir/nested/a'b.txt", 'durable-smoke')
  await pair.workspace.rename("quoted dir/nested/a'b.txt", 'quoted dir/nested/renamed.txt')
  const info = await pair.workspace.stat('quoted dir/nested/renamed.txt')
  if (info.kind !== 'file' || info.size !== 13) throw new Error('Workspace stat/rename smoke failed')
  await pair.workspace.writeBinaryFile('quoted dir/data.bin', new Uint8Array([0, 1, 2, 255]))
  const binary = await pair.workspace.readBinaryFile('quoted dir/data.bin')
  if (binary.length !== 4 || binary[3] !== 255) throw new Error('binary roundtrip failed')

  const exec = await pair.sandbox.exec("printf 'out'; printf 'err' >&2", { maxOutputBytes: 1024 })
  if (exec.exitCode !== 0 || new TextDecoder().decode(exec.stdout) !== 'out' || new TextDecoder().decode(exec.stderr) !== 'err') {
    throw new Error('separated stdout/stderr smoke failed')
  }
  const capped = await pair.sandbox.exec("head -c 4096 /dev/zero | tr '\\0' x", { maxOutputBytes: 1024 })
  if (!capped.truncated || capped.stdout.length !== 1024) throw new Error('local output cap smoke failed')
  const cwdEnv = await pair.sandbox.exec("printf '%s|%s' \"$PWD\" \"$SMOKE_ENV\"", { env: { SMOKE_ENV: 'ok' } })
  if (new TextDecoder().decode(cwdEnv.stdout) !== '/workspace|ok') throw new Error('cwd/env smoke failed')
  const nonzero = await pair.sandbox.exec('exit 7')
  if (nonzero.exitCode !== 7) throw new Error('nonzero exit smoke failed')
  let heartbeats = 0
  await pair.sandbox.exec('sleep 2', { timeoutMs: 5_000, onHeartbeat: () => { heartbeats += 1 } })
  if (heartbeats < 1) throw new Error('heartbeat smoke failed')

  const watcher = pair.workspace.watch?.()
  let watched = false
  const unsubscribe = watcher?.subscribe((event) => { if (event.path === 'native-watch.txt') watched = true })
  await pair.sandbox.exec("printf watched > native-watch.txt")
  for (let attempt = 0; attempt < 20 && !watched; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250))
  unsubscribe?.()
  watcher?.close()
  if (!watched) throw new Error('native watch smoke failed')
  const timeout = await pair.sandbox.exec('sleep 5', { timeoutMs: 500 })
  if (timeout.exitCode !== 124) throw new Error('timeout kill smoke failed')

  const controller = new AbortController()
  const aborted = pair.sandbox.exec('sleep 5', { signal: controller.signal })
  setTimeout(() => controller.abort(new Error('smoke-abort')), 300)
  await aborted.then(() => { throw new Error('abort unexpectedly resolved') }, (error) => {
    if (error?.message !== 'smoke-abort') throw error
  })

  await pair.dispose()
  await closeConnections()
  const standbyWaitMs = Number(process.env.BORING_BLAXEL_SMOKE_STANDBY_WAIT_MS ?? 65_000)
  await new Promise((resolve) => setTimeout(resolve, standbyWaitMs))
  await provider.invalidate({ workspaceId })
  pair = await provider.create(context)
  if (await pair.workspace.readFile('quoted dir/nested/renamed.txt') !== 'durable-smoke') {
    throw new Error('stable-name reconnect lost durable file')
  }
  if ((await pair.checkHealth?.())?.state !== 'ok') throw new Error('control-plane health smoke failed')
  await pair.dispose()

  await SandboxInstance.delete(sandboxName)
  await waitForVolumeRelease(volumeName)
  await provider.invalidate({ workspaceId })
  pair = await provider.create(context)
  if (await pair.workspace.readFile('quoted dir/nested/renamed.txt') !== 'durable-smoke') {
    throw new Error('Volume-backed compute recreation lost durable file')
  }
  await pair.dispose()
  console.log(JSON.stringify({ ok: true, sdk: '0.3.11', region: process.env.BORING_BLAXEL_REGION ?? 'eu-fra-1', sandboxName, volumeName }))
} catch (error) {
  process.exitCode = 1
  console.error(`Blaxel smoke failed: ${safeErrorMessage(error)}`)
} finally {
  try { await SandboxInstance.delete(sandboxName) } catch {}
  try {
    await waitForVolumeRelease(volumeName)
    try {
      await VolumeInstance.delete(volumeName)
    } catch (error) {
      if (!/not found/i.test(safeErrorMessage(error))) throw error
    }
  } catch (error) {
    cleanupFailed = true
    console.error(`Blaxel smoke cleanup incomplete: ${safeErrorMessage(error)}`)
  }
  try { await closeConnections() } catch (error) {
    cleanupFailed = true
    console.error(`Blaxel connection cleanup incomplete: ${safeErrorMessage(error)}`)
  }
}
if (cleanupFailed) process.exitCode = 1
