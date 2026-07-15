import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createFolderModeApp } from '../server/cli.js'

const tempDirs: string[] = []
const originalSessionRoot = process.env.BORING_AGENT_SESSION_ROOT

afterEach(async () => {
  if (originalSessionRoot === undefined) delete process.env.BORING_AGENT_SESSION_ROOT
  else process.env.BORING_AGENT_SESSION_ROOT = originalSessionRoot
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  }))
  return files.flat()
}

test('CLI direct folder composition creates and lists a bare native Pi first-send transcript', async () => {
  const workspaceRoot = await makeTempDir('boring-cli-native-first-send-workspace-')
  const sessionRoot = await makeTempDir('boring-cli-native-first-send-sessions-')
  process.env.BORING_AGENT_SESSION_ROOT = sessionRoot

  const app = await createFolderModeApp({
    workspaceRoot,
    mode: 'direct',
    provisionWorkspace: false,
  })

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/pi-chat/sessions/native-prompt',
      payload: {
        message: 'first native prompt',
        clientNonce: 'native-first-send',
        nativeSessionStart: { idempotencyKey: 'cli-direct-local-first-send', retry: false },
      },
    })

    expect(response.statusCode).toBe(202)
    const receipt = response.json() as {
      nativeSessionId: string
      firstSendState: 'native_persisted' | 'prompt_failed'
      session: { id: string; nativeSessionId?: string }
    }
    expect(receipt).toMatchObject({
      nativeSessionId: expect.any(String),
      firstSendState: expect.stringMatching(/^(native_persisted|prompt_failed)$/),
    })
    expect(receipt.session).toMatchObject({
      id: receipt.nativeSessionId,
      nativeSessionId: receipt.nativeSessionId,
    })

    const sessions = await app.inject({ method: 'GET', url: '/api/v1/agent/pi-chat/sessions' })
    expect(sessions.statusCode).toBe(200)
    expect(sessions.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: receipt.nativeSessionId, nativeSessionId: receipt.nativeSessionId }),
    ]))

    const transcriptFiles = await filesUnder(sessionRoot)
    expect(transcriptFiles).toHaveLength(1)
    const transcript = await readFile(transcriptFiles[0]!, 'utf8')
    expect(transcriptFiles[0]).toContain('.jsonl')
    expect(transcript).not.toContain('pi_session_file')
  } finally {
    await app.close()
  }
}, 30_000)
