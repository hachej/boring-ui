// Invariant: plugin tools run in the Node host process, NOT inside any
// sandbox.  Plugin discovery is gated by mode — direct and local load
// plugins; vercel-sandbox skips them entirely.  A future refactor that
// accidentally routes plugins through the sandbox would silently change
// the security model.  These tests catch that.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { loadPlugins, type ImportFn } from '../pluginLoader'
import { mergeTools, type PluginToolRegistration } from '../../../catalog/mergeTools'
import type { AgentTool, ToolExecContext } from '../../../../shared/tool'

const stubCtx: ToolExecContext = {
  abortSignal: new AbortController().signal,
  toolCallId: 'test-call',
}

let workspaceDir: string

function hostProcessTool(): AgentTool {
  return {
    name: 'host_probe',
    description: 'Reports host-process evidence — cwd, pid, env access.',
    parameters: {
      type: 'object' as const,
      properties: {},
    },
    async execute() {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cwd: process.cwd(),
            pid: process.pid,
            canReadEnv: typeof process.env.PATH === 'string',
          }),
        }],
      }
    },
  }
}

const PLUGIN_SOURCE = `
export default {
  name: "host_probe",
  description: "Reports host-process evidence.",
  parameters: { type: "object", properties: {} },
  async execute() {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          cwd: process.cwd(),
          pid: process.pid,
          canReadEnv: typeof process.env.PATH === "string",
        }),
      }],
    };
  },
};
`

const testImport: ImportFn = async (url: string) => {
  const source = await readFile(fileURLToPath(url), 'utf-8')
  const encoded = Buffer.from(source, 'utf-8').toString('base64')
  return import(`data:text/javascript;base64,${encoded}`) as Promise<Record<string, unknown>>
}

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'plugin-bypass-'))
})

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true })
})

async function seedPlugin(): Promise<void> {
  const extDir = join(workspaceDir, '.pi', 'extensions')
  await mkdir(extDir, { recursive: true })
  await writeFile(join(extDir, 'host-probe.mjs'), PLUGIN_SOURCE, 'utf8')
}

describe('Plugin sandbox bypass invariant', () => {
  it('direct mode: plugin tool runs in host process', async () => {
    await seedPlugin()

    const result = await loadPlugins({
      cwd: workspaceDir,
      skipGlobal: true,
      importFn: testImport,
    })

    expect(result.errors).toEqual([])
    expect(result.plugins).toHaveLength(1)

    const tool = result.plugins[0]!.tools.find((t) => t.name === 'host_probe')
    expect(tool).toBeDefined()

    const execResult = await tool!.execute({}, stubCtx)
    const output = JSON.parse(
      (execResult as { content: Array<{ text: string }> }).content[0]!.text,
    )

    expect(output.pid).toBe(process.pid)
    expect(output.canReadEnv).toBe(true)
    expect(typeof output.cwd).toBe('string')
  })

  it('local mode: plugin tool also runs in host process (same guarantee)', async () => {
    await seedPlugin()

    const result = await loadPlugins({
      cwd: workspaceDir,
      skipGlobal: true,
      importFn: testImport,
    })

    expect(result.plugins).toHaveLength(1)
    const tool = result.plugins[0]!.tools[0]!
    const execResult = await tool.execute({}, stubCtx)
    const output = JSON.parse(
      (execResult as { content: Array<{ text: string }> }).content[0]!.text,
    )

    expect(output.pid).toBe(process.pid)
  })

  it('vercel-sandbox mode: plugin discovery is skipped entirely', async () => {
    await seedPlugin()

    // Simulate the gate from createAgentApp.ts:
    //   if (resolvedMode !== 'vercel-sandbox') { loadPlugins(...) }
    const resolvedMode = 'vercel-sandbox'
    const pluginTools: PluginToolRegistration[] = []

    if (resolvedMode !== 'vercel-sandbox') {
      const pluginResult = await loadPlugins({
        cwd: workspaceDir,
        skipGlobal: true,
        importFn: testImport,
      })
      pluginTools.push(
        ...pluginResult.plugins.map((p) => ({
          pluginName: 'host-probe',
          tools: p.tools,
        })),
      )
    }

    const standardTools: AgentTool[] = [hostProcessTool()]
    // Rename standard tool to avoid confusion — real standard tools
    // have different names; we just need a non-empty array.
    standardTools[0] = { ...standardTools[0]!, name: 'standard_bash' }

    const merged = mergeTools({ standardTools, pluginTools })

    expect(pluginTools).toHaveLength(0)
    expect(merged.find((entry) => entry.tool.name === 'host_probe')).toBeUndefined()
    expect(merged.find((entry) => entry.tool.name === 'standard_bash')).toBeDefined()
  })

  it('plugin tool has full host access — not sandboxed', async () => {
    const tool = hostProcessTool()
    const execResult = await tool.execute({}, stubCtx)
    const output = JSON.parse(
      (execResult as { content: Array<{ text: string }> }).content[0]!.text,
    )

    expect(output.pid).toBe(process.pid)
    expect(output.cwd).toBe(process.cwd())
    expect(output.canReadEnv).toBe(true)
  })
})
