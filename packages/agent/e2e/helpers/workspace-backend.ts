import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkspaceAgentServer } from '../../../workspace/src/app/server/index.ts'
import { createPersistedScriptedPiHarness } from '../../src/server/testing/scriptedPiHarness.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../../..')
const args = process.argv.slice(2)
const value = (name: string): string => {
  const index = args.indexOf(name)
  const result = index >= 0 ? args[index + 1] : undefined
  if (!result) throw new Error(`${name} is required`)
  return result
}

const port = Number(value('--port'))
const workspaceRoot = value('--workspace')
const app = await createWorkspaceAgentServer({
  workspaceRoot,
  appRoot: repoRoot,
  sessionId: 'default',
  mode: 'direct',
  logger: false,
  provisionWorkspace: false,
  externalPlugins: false,
  sessionRoot: process.env.BORING_AGENT_SESSION_ROOT,
  shutdownGraceMs: 500,
  harnessFactory: createPersistedScriptedPiHarness,
  plugins: [{ dir: path.join(repoRoot, 'plugins', 'ask-user'), trust: 'internal' }],
  workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
})

const address = await app.listen({ port, host: '127.0.0.1' })
console.log(`[cli] listening at ${address}`)

let closing = false
const close = async () => {
  if (closing) return
  closing = true
  await app.close()
}
process.once('SIGTERM', () => { void close() })
process.once('SIGINT', () => { void close() })
