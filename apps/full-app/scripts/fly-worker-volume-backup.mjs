#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const app = process.env.FLY_WORKER_APP || 'boring-sandbox-worker'
const volumeName = process.env.FLY_WORKER_VOLUME_NAME || 'worker_workspace_data'
const retentionDays = positiveInteger(process.env.FLY_SNAPSHOT_RETENTION_DAYS || '14', 'FLY_SNAPSHOT_RETENTION_DAYS')
const createSnapshot = (process.env.FLY_CREATE_VOLUME_SNAPSHOT || 'true').toLowerCase() !== 'false'
const flyctl = process.env.FLYCTL_BIN || (existsSync(join(homedir(), '.fly/bin/flyctl')) ? join(homedir(), '.fly/bin/flyctl') : 'flyctl')

function positiveInteger(raw, name) {
  const parsed = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }))
}

function runFly(args, opts = {}) {
  const result = spawnSync(flyctl, args, {
    encoding: 'utf8',
    env: process.env,
    stdio: opts.json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.status !== 0) {
    const stderr = result.stderr?.trim()
    throw new Error(`flyctl ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`)
  }
  if (!opts.json) return undefined
  const stdout = result.stdout.trim()
  return stdout ? JSON.parse(stdout) : undefined
}

function volumeMatches(volume) {
  return volume && volume.name === volumeName && volume.state !== 'destroyed'
}

log('fly_worker_volume_backup.start', { app, volumeName, retentionDays, createSnapshot })
const volumes = runFly(['volumes', 'list', '--app', app, '--json'], { json: true })
const matchedVolumes = Array.isArray(volumes) ? volumes.filter(volumeMatches) : []
if (matchedVolumes.length === 0) {
  throw new Error(`no active Fly volume named ${volumeName} found for app ${app}`)
}

for (const volume of matchedVolumes) {
  log('fly_worker_volume_backup.volume', {
    id: volume.id,
    region: volume.region,
    sizeGb: volume.size_gb,
    autoBackupEnabled: volume.auto_backup_enabled,
    snapshotRetention: volume.snapshot_retention,
  })

  runFly([
    'volumes',
    'update',
    volume.id,
    '--app',
    app,
    '--scheduled-snapshots',
    '--snapshot-retention',
    String(retentionDays),
  ])
  log('fly_worker_volume_backup.retention_ok', { id: volume.id, retentionDays })

  if (createSnapshot) {
    runFly(['volumes', 'snapshots', 'create', volume.id, '--app', app])
    log('fly_worker_volume_backup.snapshot_create_requested', { id: volume.id })
  }

  const snapshots = runFly(['volumes', 'snapshots', 'list', volume.id, '--app', app, '--json'], { json: true })
  log('fly_worker_volume_backup.snapshots', {
    id: volume.id,
    count: Array.isArray(snapshots) ? snapshots.length : 0,
    latest: Array.isArray(snapshots) ? snapshots[0] : undefined,
  })
}

log('fly_worker_volume_backup.ok', { volumeCount: matchedVolumes.length })
