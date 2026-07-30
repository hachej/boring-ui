import { appendFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * `PiSessionStore.list` suppresses turn-less sessions (an unsent New chat), so
 * a fixture that must appear in a listing needs at least one turn. Appends a
 * user message to the transcript of `sessionId` somewhere under `root`.
 */
export async function appendFixtureTurn(root: string, sessionId: string): Promise<void> {
  const transcript = await findTranscript(root, sessionId)
  if (!transcript) throw new Error(`no transcript found for session '${sessionId}' under ${root}`)
  await appendFile(transcript, JSON.stringify({
    type: 'message',
    id: `fixture-turn-${sessionId}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text: 'fixture turn' }], timestamp: Date.now() },
  }) + '\n')
}

async function findTranscript(dir: string, sessionId: string): Promise<string | undefined> {
  for (const entry of await readdir(dir).catch(() => [])) {
    const path = join(dir, entry)
    if ((await stat(path)).isDirectory()) {
      const found = await findTranscript(path, sessionId)
      if (found) return found
    } else if (entry === `${sessionId}.jsonl` || entry.endsWith(`_${sessionId}.jsonl`)) {
      return path
    }
  }
  return undefined
}
