#!/usr/bin/env -S tsx
/**
 * Live provisioning eval: proves a real agent turn can see a provisioned
 * workspace skill and run a CLI installed from a provisioned SDK.
 *
 * Run:
 *   pnpm --filter @boring/agent eval:provisioning:agent
 *
 * Requires ANTHROPIC_API_KEY or OPENAI_API_KEY. Skips cleanly without one.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evalAgentPrompt } from '../src/eval/evalPrompt'
import { EvalRegex } from '../src/eval/types'
import { createAgentApp } from '../src/server/createAgentApp'
import { provisionRuntimeWorkspace } from '../src/server/workspace/provisionRuntime'
import {
  agentSandboxRuntimeHostOperations,
  createAgentSandboxRuntimeModeAdapter,
} from '../host/sandbox'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..')
const fixtureRoot = path.join(packageRoot, 'fixtures', 'provisioning')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.warn('[eval:provisioning:agent] Skipping: no LLM API key in env.')
    return 0
  }

  const model = process.env.BORING_AGENT_PROVISIONING_EVAL_MODEL
    ? JSON.parse(process.env.BORING_AGENT_PROVISIONING_EVAL_MODEL) as { provider: string; id: string }
    : process.env.OPENROUTER_API_KEY
      ? { provider: 'openrouter', id: 'qwen/qwen3.6-plus' }
      : undefined

  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'boring-agent-provisioning-agent-eval-'))
  let app: Awaited<ReturnType<typeof createAgentApp>> | null = null
  try {
    await provisionRuntimeWorkspace({
      workspaceRoot,
      contributions: [
        {
          id: 'test-sdk',
          provisioning: {
            templateDirs: [{ id: 'test-template', path: path.join(fixtureRoot, 'template') }],
            python: [
              {
                id: 'test-python-sdk',
                projectFile: path.join(fixtureRoot, 'test-sdk', 'pyproject.toml'),
                env: { BORING_PROVISION_TEST_ENV: 'from-agent-provisioner' },
              },
            ],
          },
        },
      ],
    })

    app = await createAgentApp({
      workspaceRoot,
      mode: 'direct',
      runtimeModeAdapter: createAgentSandboxRuntimeModeAdapter('direct'),
      runtimeHost: agentSandboxRuntimeHostOperations,
      logger: false,
      systemPromptAppend: `
The workspace includes a skill named test-sdk. When asked to validate provisioning, follow that skill exactly.
The command installed by provisioning is .boring-agent/bin/boring-provision-test.
`.trim(),
    })

    const result = await evalAgentPrompt({
      app,
      retries: 1,
      timeoutMs: 90_000,
      ...(model ? { model } : {}),
      prompt: `Use the test-sdk skill to validate provisioning. Run the provisioned CLI exactly as the skill says. In your final answer, include PROVISION_SKILL_SENTINEL and quote the JSON fields customEnv, templateFileExists, and args.`,
      expect: {
        tool: 'bash',
        params: {
          command: EvalRegex('boring-provision-test\\s+alpha\\s+beta'),
        },
      },
    })

    if (!result.ok) {
      console.error('[eval:provisioning:agent] tool expectation failed')
      console.error(JSON.stringify(result, null, 2))
      return 1
    }

    assert(
      result.text.includes('PROVISION_SKILL_SENTINEL'),
      'agent final answer did not include skill sentinel',
    )
    assert(
      result.text.includes('from-agent-provisioner'),
      'agent final answer did not report customEnv from CLI output',
    )
    assert(
      /templateFileExists[^\n]*(true|True)/.test(result.text) || result.text.includes('"templateFileExists":true'),
      'agent final answer did not report templateFileExists=true',
    )
    assert(
      result.text.includes('alpha') && result.text.includes('beta'),
      'agent final answer did not report CLI args alpha/beta',
    )

    console.log(JSON.stringify({
      ok: true,
      workspaceRoot,
      actualToolCalls: result.actual,
      text: result.text,
      usage: result.usage,
      attempts: result.attempts,
    }, null, 2))
    return 0
  } finally {
    if (app) await app.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('[eval:provisioning:agent] fatal:', error)
    process.exit(2)
  },
)
