import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createAgent } from '../server/createAgent'
import { projectNameFromWorkspaceRoot } from './projectName'
import { createScriptedPiHarness } from '../server/testing/scriptedPiHarness'

function parseArgs(argv: string[]): { workspaceRoot: string } {
  let workspaceRoot = process.cwd()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--port' || arg === '-p') && argv[i + 1]) {
      i += 1
    } else if (arg === '--mode' && argv[i + 1]) {
      throw new Error('packages/agent bin is pure-only; use boring-ui for bash-enabled --mode composition')
    } else if ((arg === '--workspace' || arg === '-w') && argv[i + 1]) {
      workspaceRoot = argv[++i]!
    } else if (arg === '--dev' || arg === '--no-open' || arg === '--no-gitignore') {
      // Legacy helper flags accepted as no-ops.
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  return { workspaceRoot }
}

async function readVersion(): Promise<string> {
  const pkgPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'package.json',
  )
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { name?: string; version?: string }
    return `${pkg.name ?? '@hachej/boring-agent'}@${pkg.version ?? '0.0.0'}`
  } catch {
    return '@hachej/boring-agent@0.0.0'
  }
}

const { workspaceRoot } = parseArgs(process.argv.slice(2))
const version = await readVersion()
const projectName = projectNameFromWorkspaceRoot(workspaceRoot)

const agent = createAgent({
  runtime: 'none',
  tools: [],
  workdir: workspaceRoot,
  ...(process.env.BORING_AGENT_E2E_SCRIPTED_PI === '1'
    ? { harnessFactory: createScriptedPiHarness }
    : {}),
})

try {
  await agent.sessions.create({}, { title: projectName })
} catch {
  // Non-fatal for pure initialization checks.
}

process.stderr.write(`[agent] ${version} pure runtime initialized for ${workspaceRoot}\n`)
