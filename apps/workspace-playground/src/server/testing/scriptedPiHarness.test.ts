import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScriptedPiHarness } from './scriptedPiHarness'

const runContext = (workdir: string) => ({
  abortSignal: new AbortController().signal,
  workdir,
  workspaceId: 'workspace-a',
  requestId: 'request-a',
})

describe('scripted Pi browser harness persistence', () => {
  it('hydrates canonical sessions and transcript messages after process-like recreation', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-workspace-'))
    const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-sessions-'))
    const input = { cwd: workspaceRoot, sessionRoot }
    const sessionCtx = {
      workspaceId: 'workspace-a',
      runtimeScopeIdentity: 'runtime-a',
    } as { workspaceId: string; runtimeScopeIdentity: string }

    const first = createScriptedPiHarness(input)
    const created = await first.sessions!.create(sessionCtx)
    const firstAdapter = await first.getPiSessionAdapter(
      { sessionId: created.id, ctx: sessionCtx },
      runContext(workspaceRoot),
    )
    await firstAdapter.prompt('persist me')
    const expectedMessages = firstAdapter.readSnapshot().messages

    const sessionDir = join(sessionRoot, `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
    const sessionFile = join(sessionDir, `${created.id}.jsonl`)
    expect(await readFile(sessionFile, 'utf8')).toContain('"runtimeScopeIdentity":"runtime-a"')

    const restarted = createScriptedPiHarness(input)
    await expect(restarted.sessions!.list(sessionCtx)).resolves.toEqual([
      expect.objectContaining({ id: created.id, turnCount: 1 }),
    ])
    const restartedAdapter = await restarted.getPiSessionAdapter(
      { sessionId: created.id, ctx: sessionCtx },
      runContext(workspaceRoot),
    )
    expect(restartedAdapter.readSnapshot().messages).toEqual(expectedMessages)

    await restarted.sessions!.delete(sessionCtx, created.id)
    const afterDeleteRestart = createScriptedPiHarness(input)
    await expect(afterDeleteRestart.sessions!.list(sessionCtx)).resolves.toEqual([])
  })

  it('hides other workspace records and ignores unattested or incomplete headers', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-scope-workspace-'))
    const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-scope-sessions-'))
    const input = { cwd: workspaceRoot, sessionRoot }
    const workspaceA = { workspaceId: 'workspace-a', runtimeScopeIdentity: 'runtime-a' }
    const workspaceB = { workspaceId: 'workspace-b', runtimeScopeIdentity: 'runtime-b' }
    const first = createScriptedPiHarness(input)
    const created = await first.sessions!.create(workspaceA)

    const restarted = createScriptedPiHarness(input)
    await expect(restarted.sessions!.list(workspaceB)).resolves.toEqual([])
    await expect(restarted.sessions!.load(workspaceB, created.id)).rejects.toThrow(`Session not found: ${created.id}`)

    const isolatedRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-invalid-sessions-'))
    const sessionDir = join(isolatedRoot, `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'ghost.jsonl'), '{"type":"session"', 'utf8')
    await writeFile(join(sessionDir, 'mismatch.jsonl'), `${JSON.stringify({
      type: 'session',
      id: 'different-id',
      timestamp: '2026-06-04T12:00:00.000Z',
      boringSessionCtx: { workspaceId: 'workspace-a' },
    })}\n`, 'utf8')
    await writeFile(join(sessionDir, 'unattested.jsonl'), `${JSON.stringify({
      type: 'session',
      id: 'unattested',
      timestamp: '2026-06-04T12:00:00.000Z',
      boringSessionCtx: {},
    })}\n`, 'utf8')

    const invalid = createScriptedPiHarness({ cwd: workspaceRoot, sessionRoot: isolatedRoot })
    await expect(invalid.sessions!.list(workspaceA)).resolves.toEqual([])
    await expect(invalid.sessions!.create(workspaceA)).resolves.toMatchObject({ id: 'scripted-main' })
  })
})
