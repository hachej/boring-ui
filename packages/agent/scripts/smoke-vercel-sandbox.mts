import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Sandbox } from '@vercel/sandbox'
import { getBoringAgentRuntimePaths } from '@hachej/boring-sandbox/providers/node-workspace'

import { FileHandleStore } from '../src/server/sandbox/vercel-sandbox/FileHandleStore'
import { createVercelSandboxModeAdapter } from '../src/server/runtime/modes/vercel-sandbox'
import { provisionWorkspaceRuntime } from '../src/server/workspace/provisioning'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main() {
  if (process.env.RUN_VERCEL_SANDBOX_SMOKE !== '1') {
    console.error('Skipping real Vercel sandbox smoke. Set RUN_VERCEL_SANDBOX_SMOKE=1 to run.')
    return
  }

  const token = process.env.VERCEL_TOKEN ?? process.env.VERCEL_ACCESS_TOKEN ?? process.env.VERCEL_OIDC_TOKEN
  if (!token) throw new Error('VERCEL_TOKEN, VERCEL_ACCESS_TOKEN, or VERCEL_OIDC_TOKEN is required')
  requireEnv('VERCEL_TEAM_ID')
  requireEnv('VERCEL_PROJECT_ID')

  const tempDir = await mkdtemp(join(tmpdir(), 'boring-agent-vercel-smoke-'))
  const storePath = join(tempDir, 'sandboxes.json')
  const workspaceId = `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const store = new FileHandleStore({ storePath })
  const adapter = createVercelSandboxModeAdapter({ store })
  const runtimeLayout = getBoringAgentRuntimePaths('/workspace')
  const modeCtx = {
    workspaceRoot: '/workspace',
    sessionId: workspaceId,
    workspaceId,
  }

  try {
    const provisioningAdapter = adapter.createProvisioningAdapter?.(runtimeLayout, modeCtx)
    if (!provisioningAdapter) throw new Error('vercel-sandbox mode did not provide a provisioning adapter')

    const packageRoot = resolve(process.cwd(), '../cli')
    const result = await provisionWorkspaceRuntime({
      adapter: provisioningAdapter,
      runtimeLayout,
      plugins: [{
        id: 'boring-ui-cli-smoke',
        provisioning: {
          nodePackages: [{
            id: 'boring-ui-cli',
            packageName: '@hachej/boring-ui-cli',
            packageRoot,
            expectedBins: ['boring-ui'],
          }],
        },
      }],
    })

    const bundle = await adapter.create(modeCtx)
    const node = await bundle.sandbox.exec('node --version')
    const npm = await bundle.sandbox.exec('npm --version')
    const cli = await bundle.sandbox.exec('boring-ui --help', {
      env: { PATH: [runtimeLayout.nodeBin, ...(result.pathEntries ?? []), '/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/usr/local/bin:/usr/bin:/bin'].join(':') },
      timeoutMs: 30_000,
    })

    if (node.exitCode !== 0) throw new Error('node --version failed')
    if (npm.exitCode !== 0) throw new Error('npm --version failed')
    if (cli.exitCode !== 0) {
      throw new Error(`boring-ui --help failed: ${Buffer.from(cli.stderr).toString('utf8')}`)
    }

    console.log(JSON.stringify({
      ok: true,
      workspaceId,
      node: Buffer.from(node.stdout).toString('utf8').trim(),
      npm: Buffer.from(npm.stdout).toString('utf8').trim(),
      pathEntries: result.pathEntries,
    }, null, 2))
  } finally {
    const records = await store.list().catch(() => [])
    await Promise.all(records.map(async (record) => {
      try {
        const sandbox = await Sandbox.get({
          token,
          teamId: process.env.VERCEL_TEAM_ID!,
          projectId: process.env.VERCEL_PROJECT_ID!,
          name: record.sandboxId,
          resume: true,
        } as Parameters<typeof Sandbox.get>[0] & { name?: string })
        await sandbox.delete()
      } catch (error) {
        console.warn(`Failed to delete smoke sandbox ${record.sandboxId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }))
    await adapter.dispose?.().catch(() => undefined)
    await rm(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
