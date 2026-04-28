#!/usr/bin/env tsx
/**
 * Vercel sandbox smoke test — verifies the four behaviors we need
 * for the pi-tools-migration plan:
 *
 *   1. Sandbox.create() works at all
 *   2. runCommand({ stdout: Writable }) STREAMS output as bytes arrive
 *      (NOT one big chunk at end) — the answer that gates bead uhwx.16
 *   3. abortSignal kills the process mid-command
 *   4. fs roundtrip: writeFiles + sandbox.fs.read
 */

import { Sandbox } from '@vercel/sandbox'
import { Writable } from 'node:stream'

const TOKEN = process.env.VERCEL_TOKEN!
const TEAM_ID = process.env.VERCEL_TEAM_ID!
const PROJECT_ID = process.env.VERCEL_PROJECT_ID!

if (!TOKEN || !TEAM_ID || !PROJECT_ID) {
  console.error('Missing VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID env vars')
  process.exit(1)
}

const creds = { token: TOKEN, teamId: TEAM_ID, projectId: PROJECT_ID }

const t0 = Date.now()
console.log('[1/4] Creating sandbox…')
const sandbox = await Sandbox.create({ ...creds })
console.log(`      ✓ sandbox created in ${Date.now() - t0}ms (id=${sandbox.sandboxId})`)

try {
  // [2/4] Streaming check
  console.log('[2/4] Streaming check — running `for i in $(seq 1 100); do echo line-$i; sleep 0.01; done`')
  const writeCalls: { ms: number; bytes: number }[] = []
  const t1 = Date.now()
  const stdoutWritable = new Writable({
    write(chunk, _enc, cb) {
      writeCalls.push({ ms: Date.now() - t1, bytes: chunk.length })
      cb()
    },
  })
  const stderrWritable = new Writable({
    write(_chunk, _enc, cb) {
      cb()
    },
  })
  const result = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-c', 'for i in $(seq 1 100); do echo line-$i; sleep 0.01; done'],
    stdout: stdoutWritable,
    stderr: stderrWritable,
  })
  const totalMs = Date.now() - t1
  console.log(
    `      runCommand returned exitCode=${result.exitCode} after ${totalMs}ms`,
  )
  console.log(
    `      Writable.write was called ${writeCalls.length} times. First few: ${writeCalls
      .slice(0, 5)
      .map((c) => `+${c.ms}ms/${c.bytes}B`)
      .join(', ')}`,
  )
  if (writeCalls.length >= 2 && writeCalls[0].ms < totalMs / 2) {
    console.log('      ✓ STREAMING — chunks arrived spread across the run')
  } else if (writeCalls.length >= 2) {
    console.log('      ⚠ MULTIPLE chunks but all arrived near the end (semi-streaming)')
  } else {
    console.log('      ✗ NOT STREAMING — single Writable.write at end (R5 unmitigated)')
  }

  // [3/4] Abort check
  console.log('[3/4] Abort check — `sleep 30`, abort at +500ms')
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 500)
  const t2 = Date.now()
  try {
    await sandbox.runCommand({
      cmd: 'bash',
      args: ['-c', 'sleep 30'],
      signal: ac.signal,
    })
    console.log(`      ⚠ runCommand did NOT throw on abort (returned after ${Date.now() - t2}ms)`)
  } catch (err: any) {
    const elapsed = Date.now() - t2
    console.log(
      `      ✓ runCommand threw after ${elapsed}ms (expected ~500ms): ${err.message ?? err}`,
    )
  }

  // [4/4] FS roundtrip
  console.log('[4/4] FS roundtrip — writeFiles + read')
  const path = '/vercel/sandbox/smoke.txt'
  const content = `hello from smoke-test at ${new Date().toISOString()}`
  await sandbox.writeFiles([{ path, content: Buffer.from(content) }])
  const readback = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-c', `cat ${path}`],
  })
  const stdout = await readback.stdout()
  if (stdout.trim() === content) {
    console.log('      ✓ writeFiles + cat roundtrip works')
  } else {
    console.log(`      ✗ MISMATCH: wrote "${content}" got "${stdout}"`)
  }
} finally {
  console.log('Cleanup: stopping sandbox…')
  await sandbox.stop().catch((e) => console.log(`stop error (likely ok): ${e.message}`))
  console.log(`Total time: ${Date.now() - t0}ms`)
}
