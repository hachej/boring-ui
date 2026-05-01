#!/usr/bin/env -S tsx
/**
 * Live Vercel Sandbox provisioning eval.
 *
 * This proves a real vercel-sandbox agent can use a provisioned workspace
 * skill and run a CLI from the fixture SDK. Until the generic provisioner
 * grows a remote Workspace/Sandbox executor, this script seeds the fixture
 * via templatePath and performs the SDK install through a setup agent turn.
 *
 * Run:
 *   OPENROUTER_API_KEY=... VERCEL_TOKEN=... VERCEL_TEAM_ID=... pnpm --filter @boring/agent eval:provisioning:agent:vercel
 */
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evalAgentPrompt } from '../src/eval/evalPrompt'
import { EvalRegex } from '../src/eval/types'
import { createAgentApp } from '../src/server/createAgentApp'
import { resolveMode } from '../src/server/runtime/resolveMode'
import type { RuntimeModeAdapter } from '../src/server/runtime/mode'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..')
const fixtureRoot = path.join(packageRoot, 'fixtures', 'provisioning')

function hasVercelAuth(): boolean {
  return Boolean(
    (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN) &&
    process.env.VERCEL_TEAM_ID,
  )
}

function hasModelAuth(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function createTemplateWithSdk(): Promise<string> {
  const templateRoot = await mkdtemp(path.join(tmpdir(), 'boring-agent-vercel-provisioning-template-'))
  await cp(path.join(fixtureRoot, 'template'), templateRoot, { recursive: true })
  await cp(path.join(fixtureRoot, 'test-sdk'), path.join(templateRoot, 'test-sdk'), { recursive: true })
  return templateRoot
}

async function main(): Promise<number> {
  if (!hasModelAuth()) {
    console.warn('[eval:provisioning:agent:vercel] Skipping: no LLM API key in env.')
    return 0
  }
  if (!hasVercelAuth()) {
    console.warn('[eval:provisioning:agent:vercel] Skipping: missing Vercel auth env (VERCEL_TOKEN/ACCESS/OIDC + VERCEL_TEAM_ID).')
    return 0
  }

  const templatePath = await createTemplateWithSdk()
  const workspaceRoot = `vercel-provisioning-eval-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let app: Awaited<ReturnType<typeof createAgentApp>> | null = null
  let adapter: RuntimeModeAdapter | null = null

  try {
    adapter = resolveMode('vercel-sandbox')
    const setupBundle = await adapter.create({
      workspaceRoot,
      sessionId: workspaceRoot,
      templatePath,
    })

    const setupCommand = [
      'set -euo pipefail',
      'python3 -m venv .venv',
      '.venv/bin/python -m pip install ./test-sdk',
      'mkdir -p .boring-agent/bin',
      `cat > .boring-agent/bin/boring-provision-test <<'SH'`,
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'WORKSPACE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"',
      'export BORING_AGENT_WORKSPACE_ROOT="$WORKSPACE_ROOT"',
      `export BORING_PROVISION_TEST_ENV='from-agent-provisioner'`,
      'exec "$WORKSPACE_ROOT/.venv/bin/boring-provision-test" "$@"',
      'SH',
      'chmod +x .boring-agent/bin/boring-provision-test',
      '.boring-agent/bin/boring-provision-test alpha beta',
    ].join('\n')

    const setup = await setupBundle.sandbox.exec(setupCommand, {
      cwd: setupBundle.workspace.root,
      timeoutMs: 180_000,
      maxOutputBytes: 1024 * 1024,
    })
    const setupStdout = new TextDecoder().decode(setup.stdout)
    const setupStderr = new TextDecoder().decode(setup.stderr)
    if (setup.exitCode !== 0) {
      throw new Error(`Vercel fixture setup failed with exit ${setup.exitCode}: ${setupStderr || setupStdout}`)
    }
    assert(setupStdout.includes('from-agent-provisioner'), 'setup command did not run fixture CLI with env')
    assert(setupStdout.includes('alpha') && setupStdout.includes('beta'), 'setup command did not run fixture CLI with args')

    app = await createAgentApp({
      workspaceRoot,
      sessionId: workspaceRoot,
      templatePath,
      mode: 'vercel-sandbox',
      logger: false,
      systemPromptAppend: `
The workspace includes a skill named test-sdk and a local fixture SDK at ./test-sdk.
When asked to validate provisioning, follow the test-sdk skill exactly.
`.trim(),
    })

    const result = await evalAgentPrompt({
      app,
      model: { provider: 'openrouter', id: 'qwen/qwen3.6-plus' },
      retries: 1,
      timeoutMs: 120_000,
      prompt: `Use the test-sdk skill to validate provisioning. Run the provisioned CLI exactly as the skill says. In your final answer, include PROVISION_SKILL_SENTINEL and quote the JSON fields customEnv, templateFileExists, and args.`,
      expect: {
        tool: 'bash',
        params: { command: EvalRegex('boring-provision-test\\s+alpha\\s+beta') },
      },
    })

    if (!result.ok) {
      console.error('[eval:provisioning:agent:vercel] validation tool expectation failed')
      console.error(JSON.stringify(result, null, 2))
      return 1
    }

    assert(result.text.includes('PROVISION_SKILL_SENTINEL'), 'agent final answer did not include skill sentinel')
    assert(result.text.includes('from-agent-provisioner'), 'agent final answer did not report customEnv')
    assert(/templateFileExists[\s\S]*(true|True)/.test(result.text), 'agent final answer did not report templateFileExists=true')
    assert(result.text.includes('alpha') && result.text.includes('beta'), 'agent final answer did not report CLI args alpha/beta')

    console.log(JSON.stringify({
      ok: true,
      mode: 'vercel-sandbox',
      workspaceRoot,
      setup: {
        exitCode: setup.exitCode,
        stdout: setupStdout,
        stderr: setupStderr,
      },
      validationToolCalls: result.actual,
      text: result.text,
      usage: {
        validation: result.usage,
      },
    }, null, 2))
    return 0
  } finally {
    if (app) await app.close()
    else await adapter?.dispose?.()
    await rm(templatePath, { recursive: true, force: true })
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('[eval:provisioning:agent:vercel] fatal:', error)
    process.exit(2)
  },
)
