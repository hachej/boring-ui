import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('PiSessionStore rename capability', () => {
  it('uses the wrapper as the sole title authority for linked sessions', async () => {
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
      JSON.stringify({ type: 'custom', id: 'legacy-native-marker', parentId: 'native-tie', timestamp: tie, customType: 'boring.session-title-authority', data: { titleSetByUser: true, title: 'legacy-native-manual' } }),
      JSON.stringify({ type: 'session_info', id: 'legacy-native-manual', parentId: 'legacy-native-marker', timestamp: tie, name: 'legacy-native-manual' }),
      JSON.stringify({ type: 'session_info', id: 'native-auto-after-manual', parentId: 'legacy-native-manual', timestamp: tie, name: 'native-auto-after-manual' }),
      '',
    ].join('\n'))

    // Linked-native authority is legacy metadata; the wrapper is the sole
    // authority owner, so the linked transcript projects its latest plain title.
    expect((await store.load({ workspaceId: 'workspace-a' }, sessionId)).title).toBe('native-auto-after-manual')
    const renamed = await store.rename({ workspaceId: 'workspace-a' }, sessionId, 'renamed')
    expect(renamed.title).toBe('renamed')

    const wrapperEntries = (await readFile(wrapper, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(wrapperEntries.at(-1)).toMatchObject({ type: 'session_info', name: 'renamed' })
    const nativeEntries = (await readFile(native, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(nativeEntries.at(-1)).toMatchObject({ type: 'session_info', name: 'native-auto-after-manual' })

    // A later linked-native auto title cannot override wrapper authority.
    nativeEntries.push({ type: 'session_info', id: 'native-later', parentId: 'native-tie', timestamp: '2099-01-01T00:00:00.000Z', name: 'native-later' })
    await writeFile(native, `${nativeEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    expect((await new PiSessionStore(root, root).load({ workspaceId: 'workspace-a' }, sessionId)).title).toBe('renamed')
  })

  it('serializes concurrent rename writers on the canonical transcript', async () => {
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
