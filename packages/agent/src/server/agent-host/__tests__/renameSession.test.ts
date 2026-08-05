import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('PiSessionStore rename capability', () => {
  it('appends every resolved wrapper/native transcript and uses deterministic newest title authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rename-session-'))
    roots.push(root)
    const store = new PiSessionStore(root, root)
    const sessionId = 'legacy-wrapper'
    const wrapper = join(root, `${sessionId}.jsonl`)
    const native = join(root, `2026-07-23T00-00-00_${sessionId}.jsonl`)
    const tie = '2026-07-23T00:00:00.000Z'
    await writeFile(wrapper, [
      JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: tie, cwd: root, boringSessionCtx: { workspaceId: 'workspace-a' } }),
      JSON.stringify({ type: 'session_info', id: 'wrapper-tie', parentId: null, timestamp: tie, name: 'wrapper-tie' }),
      JSON.stringify({ type: 'pi_session_file', timestamp: tie, path: native }),
      '',
    ].join('\n'))
    await writeFile(native, [
      JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: tie, cwd: root }),
      JSON.stringify({ type: 'session_info', id: 'native-tie', parentId: null, timestamp: tie, name: 'native-tie' }),
      '',
    ].join('\n'))

    expect((await store.load({ workspaceId: 'workspace-a' }, sessionId)).title).toBe('native-tie')
    const renamed = await store.rename({ workspaceId: 'workspace-a' }, sessionId, 'renamed')
    expect(renamed.title).toBe('renamed')

    for (const file of [wrapper, native]) {
      const entries = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
      expect(entries.at(-1)).toMatchObject({ type: 'session_info', name: 'renamed' })
    }
  })

  it('serializes concurrent rename writers and leaves both transcripts converged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rename-session-writer-'))
    roots.push(root)
    const store = new PiSessionStore(root, root)
    const created = await store.create({}, { title: 'start' })
    await Promise.all([
      store.rename({}, created.id, 'first'),
      store.rename({}, created.id, 'second'),
    ])
    expect((await store.load({}, created.id)).title).toBe('second')
  })
})
