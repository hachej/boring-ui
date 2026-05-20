#!/usr/bin/env -S tsx
/**
 * Repro for boring-ui-v2-reorg-ocu7.
 *
 * Verifies that a real Vercel Sandbox can execute commands with the actual
 * command cwd set to /workspace without rewriting arbitrary user command text.
 *
 * Required auth:
 * - VERCEL_OIDC_TOKEN; or
 * - VERCEL_TOKEN/VERCEL_ACCESS_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID
 *
 * Run from repo root:
 *   pnpm --filter @hachej/boring-agent exec tsx scripts/spike-vercel-workspace-cwd.mts
 */
import { Writable } from 'node:stream'

import { Sandbox } from '@vercel/sandbox'

function hasVercelAuth(): boolean {
  if (process.env.VERCEL_OIDC_TOKEN) return true
  return Boolean(
    (process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN) &&
    process.env.VERCEL_TEAM_ID &&
    process.env.VERCEL_PROJECT_ID,
  )
}

function authHint(): string {
  return 'Set VERCEL_OIDC_TOKEN, or VERCEL_TOKEN/VERCEL_ACCESS_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID.'
}

function streamCollector() {
  const chunks: Buffer[] = []
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    }),
    text() {
      return Buffer.concat(chunks).toString('utf-8')
    },
  }
}

async function run(
  sandbox: Sandbox,
  label: string,
  params: Parameters<Sandbox['runCommand']>[0],
): Promise<{ label: string; exitCode: number | null; cwd?: string; stdout: string; stderr: string }> {
  const stdout = streamCollector()
  const stderr = streamCollector()
  const result = await sandbox.runCommand({
    ...(params as Extract<Parameters<Sandbox['runCommand']>[0], object>),
    stdout: stdout.stream,
    stderr: stderr.stream,
  })

  return {
    label,
    exitCode: result.exitCode,
    cwd: 'cwd' in result ? result.cwd : undefined,
    stdout: stdout.text(),
    stderr: stderr.text(),
  }
}

function createParams(name: string): Parameters<typeof Sandbox.create>[0] {
  const token = process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN
  if (token) {
    return {
      name,
      token,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      runtime: 'node24',
      persistent: false,
      timeout: 5 * 60 * 1000,
    } as Parameters<typeof Sandbox.create>[0]
  }

  return {
    name,
    runtime: 'node24',
    persistent: false,
    timeout: 5 * 60 * 1000,
  }
}

async function main(): Promise<number> {
  if (!hasVercelAuth()) {
    console.warn(`[spike:vercel-workspace-cwd] skipped: ${authHint()}`)
    return 0
  }

  const name = `boring-workspace-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const sandbox = await Sandbox.create(createParams(name))
  const log: unknown[] = []

  try {
    const uid = (await run(sandbox, 'id -u', { cmd: 'id', args: ['-u'] })).stdout.trim()
    const gid = (await run(sandbox, 'id -g', { cmd: 'id', args: ['-g'] })).stdout.trim()

    log.push(await run(sandbox, 'create real /workspace', {
      cmd: 'install',
      args: ['-d', '-m', '755', '-o', uid, '-g', gid, '/workspace'],
      sudo: true,
    }))

    await sandbox.writeFiles([
      { path: '/workspace/sdk-write.txt', content: 'written-through-sdk' },
    ])

    // The command text below intentionally does not contain /workspace. The
    // public root is provided only through runCommand cwd/env metadata.
    const probe = await run(sandbox, 'cwd /workspace probe without command rewrite', {
      cmd: 'sh',
      args: ['-c', [
        'set -eu',
        'printf rel-write > rel.txt',
        'printf "pwd=%s\\n" "$(pwd)"',
        'printf "PWD=%s\\n" "$PWD"',
        'printf "BORING_AGENT_WORKSPACE_ROOT=%s\\n" "$BORING_AGENT_WORKSPACE_ROOT"',
        'printf "nodeCwd=%s\\n" "$(node -p \'process.cwd()\')"',
        'printf "rel=%s\\n" "$(cat rel.txt)"',
        'printf "sdk=%s\\n" "$(cat sdk-write.txt)"',
      ].join('\n')],
      cwd: '/workspace',
      env: {
        PWD: '/workspace',
        BORING_AGENT_WORKSPACE_ROOT: '/workspace',
      },
    })
    log.push(probe)

    const ok = probe.exitCode === 0 &&
      probe.stdout.includes('pwd=/workspace\n') &&
      probe.stdout.includes('PWD=/workspace\n') &&
      probe.stdout.includes('BORING_AGENT_WORKSPACE_ROOT=/workspace\n') &&
      probe.stdout.includes('nodeCwd=/workspace\n') &&
      probe.stdout.includes('rel=rel-write\n') &&
      probe.stdout.includes('sdk=written-through-sdk\n')

    console.log(JSON.stringify({
      ok,
      sandbox: { name },
      mechanism: 'real /workspace directory created once; runCommand cwd/env metadata set to /workspace; no user command string rewriting',
      log,
    }, null, 2))

    return ok ? 0 : 1
  } finally {
    await sandbox.stop({ blocking: true }).catch(() => undefined)
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('[spike:vercel-workspace-cwd] fatal:', error)
    process.exit(2)
  },
)
