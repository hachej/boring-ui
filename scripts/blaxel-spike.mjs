#!/usr/bin/env node

import {
  closeConnections,
  createDriveAccessToken,
  DriveInstance,
  SandboxInstance,
} from '@blaxel/core'

const requiredEnv = ['BL_API_KEY', 'BL_WORKSPACE']
for (const name of requiredEnv) {
  if (!process.env[name]) {
    throw new Error(`${name} is required`)
  }
}

const sandboxName = `boring-blaxel-spike-${Date.now().toString(36)}`
const driveName = `${sandboxName}-drive`
const region = process.env.BLAXEL_SPIKE_REGION || 'us-was-1'
const idleWaitMs = Number(process.env.BLAXEL_SPIKE_IDLE_WAIT_MS || 20_000)
const testDrive = process.env.BLAXEL_SPIKE_TEST_DRIVE !== '0'
const secrets = [process.env.BL_API_KEY, process.env.BL_WORKSPACE].filter(Boolean)
const startedAt = new Date().toISOString()

let sandbox
let drive
let sandboxCreateAttempted = false
let driveCreateAttempted = false
let driveCreateRejected = false

function elapsedMs(started) {
  return Number((performance.now() - started).toFixed(1))
}

function sanitize(value) {
  let text = String(value ?? '')
  for (const secret of secrets) {
    text = text.replaceAll(secret, '<redacted>')
  }
  text = text.replace(
    /BL_(?:ACCOUNT_ID|S_CUSTOMER_ID|WORKSPACE_ID)=[^ '"]+/g,
    (match) => `${match.slice(0, match.indexOf('=') + 1)}<redacted>`,
  )
  return text
}

function safeError(error) {
  const details = error && typeof error === 'object' ? error : {}
  return {
    name: sanitize(details.name || 'Error'),
    message: sanitize(details.message || details.error || error),
    status: details.status ?? details.response?.status ?? details.code,
    code: details.code,
    documentation: details.documentation
      ? sanitize(details.documentation)
      : undefined,
  }
}

async function exec(command) {
  const started = performance.now()
  try {
    const result = await sandbox.process.exec({
      command,
      waitForCompletion: true,
      timeout: 30,
    })
    return {
      command,
      durationMs: elapsedMs(started),
      exitCode: result.exitCode,
      status: result.status,
      stdout: sanitize(result.stdout),
      stderr: sanitize(result.stderr),
    }
  } catch (error) {
    return {
      command,
      durationMs: elapsedMs(started),
      error: safeError(error),
    }
  }
}

async function probeDrive() {
  const result = {
    attempted: true,
    region,
    create: null,
    mount: null,
    fileRoundTrip: null,
    s3: null,
  }

  let started = performance.now()
  try {
    driveCreateAttempted = true
    drive = await DriveInstance.create({
      name: driveName,
      region,
      labels: { purpose: 'boring-ui-blaxel-spike' },
    })
    result.create = {
      ok: true,
      durationMs: elapsedMs(started),
      region: drive.region,
      hasS3Url: Boolean(drive.state?.s3Url),
    }

    started = performance.now()
    const mount = await sandbox.drives.mount({
      driveName,
      mountPath: '/mnt/blaxel-spike',
      drivePath: '/',
    })
    result.mount = {
      ok: mount.success === true,
      durationMs: elapsedMs(started),
      mountPath: mount.mountPath,
      readOnly: mount.readOnly,
    }

    const payload = `plain-file-${Date.now()}`
    started = performance.now()
    await sandbox.fs.write('/mnt/blaxel-spike/plain-file.txt', payload)
    const mountedRead = await sandbox.fs.read('/mnt/blaxel-spike/plain-file.txt')
    result.fileRoundTrip = {
      ok: mountedRead === payload,
      durationMs: elapsedMs(started),
      path: '/mnt/blaxel-spike/plain-file.txt',
      bytes: Buffer.byteLength(payload),
      content: sanitize(mountedRead),
    }

    if (!drive.state?.s3Url) {
      drive = await DriveInstance.get(driveName)
    }

    if (!drive.state?.s3Url) {
      result.s3 = { ok: false, blocker: 'Drive state did not expose s3Url.' }
      return result
    }

    started = performance.now()
    const tokenResponse = await createDriveAccessToken({
      path: { driveName },
      throwOnError: true,
    })
    const token = tokenResponse.data?.access_token
    if (!token) {
      result.s3 = {
        ok: false,
        durationMs: elapsedMs(started),
        blocker: 'Drive access-token response did not contain an access token.',
      }
      return result
    }

    const objectUrl = new URL(
      `${drive.state.s3Url.replace(/\/$/, '')}/plain-file.txt`,
    )
    const response = await fetch(objectUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const directRead = await response.text()
    result.s3 = {
      ok: response.ok && directRead === payload,
      durationMs: elapsedMs(started),
      httpStatus: response.status,
      endpointOrigin: objectUrl.origin,
      pathStyle: true,
      sameBytesAsMountedFile: directRead === payload,
      responseBytes: Buffer.byteLength(directRead),
      responseBody: response.ok
        ? sanitize(directRead)
        : sanitize(directRead.slice(0, 500)),
    }
  } catch (error) {
    if (
      !drive &&
      (error?.code === 403 || error?.status === 403 || error?.response?.status === 403)
    ) {
      driveCreateRejected = true
    }
    const failure = { ok: false, error: safeError(error) }
    if (!result.create) result.create = failure
    else if (!result.mount) result.mount = failure
    else if (!result.fileRoundTrip) result.fileRoundTrip = failure
    else result.s3 = failure
  }
  return result
}

const report = {
  schema: 'boring-ui.blaxel-spike.v1',
  startedAt,
  sdk: '@blaxel/core',
  sandboxName,
  region,
  lifecycle: {},
  exec: {},
  filesystem: {},
  isolation: [],
  drive: testDrive ? null : { attempted: false },
  cleanup: {},
}

try {
  let started = performance.now()
  sandboxCreateAttempted = true
  sandbox = await SandboxInstance.create({
    name: sandboxName,
    image: 'blaxel/base-image:latest',
    memory: 1024,
    region,
    ttl: '10m',
    labels: { purpose: 'boring-ui-blaxel-spike' },
  })
  report.lifecycle.createMs = elapsedMs(started)
  report.lifecycle.statusAfterCreate = sandbox.status

  report.exec.uname = await exec('uname -a')
  report.exec.echo = await exec("printf 'hi\\n'")

  started = performance.now()
  const payload = `hello-from-boring-ui-${Date.now()}`
  await sandbox.fs.mkdir('/workspace')
  await sandbox.fs.write('/workspace/blaxel-spike.txt', payload)
  const readBack = await sandbox.fs.read('/workspace/blaxel-spike.txt')
  const listing = await sandbox.fs.ls('/workspace')
  report.filesystem = {
    durationMs: elapsedMs(started),
    path: '/workspace/blaxel-spike.txt',
    writeReadEqual: readBack === payload,
    readBack: sanitize(readBack),
    listing,
  }

  const isolationCommands = [
    'systemd-detect-virt',
    "cat /proc/cpuinfo | grep -i hypervisor",
    "dmesg 2>/dev/null | grep -iE 'firecracker|kvm|virtio' | grep -vE '^(.*Command line:|.*Kernel command line:)' | head",
    'cat /sys/class/dmi/id/product_name 2>/dev/null',
    'hostname',
    "ls /dev | grep -iE 'kvm|vsock'",
    "cat /proc/1/cgroup",
    "mount | head -40",
  ]
  for (const command of isolationCommands) {
    report.isolation.push(await exec(command))
  }

  if (testDrive) {
    report.drive = await probeDrive()
  }

  sandbox.h2Session?.close()
  await closeConnections()
  report.lifecycle.idleWaitMs = idleWaitMs
  await new Promise((resolve) => setTimeout(resolve, idleWaitMs))

  started = performance.now()
  sandbox = await SandboxInstance.get(sandboxName)
  const resumeExec = await exec("printf 'resumed\\n'")
  report.lifecycle.firstOperationAfterIdleMs = elapsedMs(started)
  report.lifecycle.resumeProbe = resumeExec
  report.lifecycle.resumeQualification =
    'Measured after closing SDK connections and waiting; control-plane state was not polled because polling itself can resume the sandbox.'
} catch (error) {
  report.fatal = safeError(error)
  process.exitCode = 1
} finally {
  if (sandbox || sandboxCreateAttempted) {
    const started = performance.now()
    try {
      if (sandbox) await sandbox.delete()
      else await SandboxInstance.delete(sandboxName)
      report.cleanup.sandbox = { ok: true, durationMs: elapsedMs(started) }
    } catch (error) {
      const cleanupError = safeError(error)
      if (cleanupError.status === 404 || cleanupError.code === 404) {
        report.cleanup.sandbox = {
          ok: true,
          durationMs: elapsedMs(started),
          alreadyAbsent: true,
        }
      } else {
        report.cleanup.sandbox = { ok: false, error: cleanupError }
        process.exitCode = 1
      }
    }
  }
  if (drive || (driveCreateAttempted && !driveCreateRejected)) {
    const started = performance.now()
    try {
      if (drive) await drive.delete()
      else await DriveInstance.delete(driveName)
      report.cleanup.drive = { ok: true, durationMs: elapsedMs(started) }
    } catch (error) {
      const cleanupError = safeError(error)
      if (cleanupError.status === 404 || cleanupError.code === 404) {
        report.cleanup.drive = {
          ok: true,
          durationMs: elapsedMs(started),
          alreadyAbsent: true,
        }
      } else {
        report.cleanup.drive = { ok: false, error: cleanupError }
        process.exitCode = 1
      }
    }
  }
  await closeConnections().catch(() => {})
  report.finishedAt = new Date().toISOString()
  process.stdout.write(`${sanitize(JSON.stringify(report, null, 2))}\n`)
}
