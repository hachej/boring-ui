import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScriptedPiHarness, markPlaygroundShowcaseSession } from './scriptedPiHarness'

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
    const sessionCtx = { workspaceId: 'workspace-a' }

    const first = createScriptedPiHarness(input)
    const created = await first.sessions!.create(sessionCtx)
    const firstAdapter = await first.getPiSessionAdapter(
      { sessionId: created.id, ctx: sessionCtx },
      runContext(workspaceRoot),
    )
    await firstAdapter.prompt('persist me')
    const expectedMessages = firstAdapter.readSnapshot().messages

    const sessionDir = join(sessionRoot, `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
    const sessionName = (await readdir(sessionDir)).find((name) => name.endsWith(`_${created.id}.jsonl`))
    expect(sessionName).toBeTruthy()
    const sessionFile = join(sessionDir, sessionName!)
    expect(await readFile(sessionFile, 'utf8')).toContain('"workspaceId":"workspace-a"')

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

  it('keeps repeated creates unique and restart-hydratable beside an oversized numeric suffix', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-counter-workspace-'))
    const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-counter-sessions-'))
    const sessionDir = join(sessionRoot, `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
    await mkdir(sessionDir, { recursive: true })
    const largeId = 'scripted-99999999999999999999'
    await writeFile(join(sessionDir, `${largeId}.jsonl`), `${JSON.stringify({
      type: 'session',
      id: largeId,
      timestamp: '2026-06-04T12:00:00.000Z',
      boringSessionCtx: { workspaceId: 'workspace-a' },
    })}\n`, 'utf8')
    const ctx = { workspaceId: 'workspace-a' }
    const first = createScriptedPiHarness({ cwd: workspaceRoot, sessionRoot })
    const createdA = await first.sessions!.create(ctx)
    const createdB = await first.sessions!.create(ctx)
    expect([createdA.id, createdB.id]).toEqual(['scripted-main', 'scripted-1'])

    const restarted = createScriptedPiHarness({ cwd: workspaceRoot, sessionRoot })
    const createdC = await restarted.sessions!.create(ctx)
    expect(createdC.id).toBe('scripted-2')
    const ids = (await restarted.sessions!.list(ctx, { includeEmpty: true })).map((session) => session.id)
    expect(new Set(ids)).toEqual(new Set([largeId, 'scripted-main', 'scripted-1', 'scripted-2']))
  })

  it('hides other workspace records and ignores unattested or incomplete headers', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-scope-workspace-'))
    const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-scope-sessions-'))
    const input = { cwd: workspaceRoot, sessionRoot }
    const workspaceA = { workspaceId: 'workspace-a' }
    const workspaceB = { workspaceId: 'workspace-b' }
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

  // gh-1452 PR #1458 review: showcase-session provenance used to be a fixed
  // title prefix, which an ordinary session's title could collide with (the
  // create/rename HTTP schemas accept any title). Provenance is now a
  // sidecar registry keyed by session id, marked only via
  // `markPlaygroundShowcaseSession` (the dev-only wrapper route in dev.ts
  // calls this — never reachable from the ordinary session-creation UI).
  describe('showcase session provenance registry', () => {
    it('sweeps a marked, still-empty session from a previous boot without touching an ordinary session even when its title copies the old removed tag text', async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-workspace-'))
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-sessions-'))
      const input = { cwd: workspaceRoot, sessionRoot }
      const ctx = { workspaceId: 'workspace-a' }

      const first = createScriptedPiHarness(input)
      const showcaseSession = await first.sessions!.create(ctx, { title: 'Navigation polish review' })
      await markPlaygroundShowcaseSession(sessionRoot, showcaseSession.id)

      // A developer's own ordinary session, never marked, whose title
      // happens to spell out the exact string the old (removed) title-tag
      // mechanism used to look for. If provenance were still title-based,
      // this would get swept — it must not be.
      const collidingTitle = '[playground-showcase] my ordinary draft'
      const ordinarySession = await first.sessions!.create(ctx, { title: collidingTitle })

      // Simulate a process restart: a fresh store instance re-hydrates from
      // disk and runs its boot-time sweep exactly once.
      const restarted = createScriptedPiHarness(input)
      const afterRestart = await restarted.sessions!.list(ctx, { includeEmpty: true })
      const idsAfterRestart = afterRestart.map((session) => session.id)

      expect(idsAfterRestart).not.toContain(showcaseSession.id)
      expect(idsAfterRestart).toContain(ordinarySession.id)
      expect(afterRestart.find((session) => session.id === ordinarySession.id)?.title).toBe(collidingTitle)
    })

    it('stops tracking (and never sweeps) a marked session once it has a real turn', async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-used-workspace-'))
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-used-sessions-'))
      const input = { cwd: workspaceRoot, sessionRoot }
      const ctx = { workspaceId: 'workspace-a' }

      const first = createScriptedPiHarness(input)
      const session = await first.sessions!.create(ctx, { title: 'Navigation polish review' })
      await markPlaygroundShowcaseSession(sessionRoot, session.id)
      const adapter = await first.getPiSessionAdapter(
        { sessionId: session.id, ctx },
        runContext(workspaceRoot),
      )
      await adapter.prompt('a real turn')

      const restarted = createScriptedPiHarness(input)
      await expect(restarted.sessions!.list(ctx)).resolves.toContainEqual(
        expect.objectContaining({ id: session.id, turnCount: 1 }),
      )
    })

    it('leaves an unrelated registry entry alone when this store cannot find it (different session store)', async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-foreign-workspace-'))
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-foreign-sessions-'))
      const ctx = { workspaceId: 'workspace-a' }

      // Mark an id that no session in this sessionRoot will ever create —
      // standing in for an id that belongs to a different agent
      // type/namespace's store sharing the same registry file.
      await markPlaygroundShowcaseSession(sessionRoot, 'scripted-belongs-elsewhere')

      const harness = createScriptedPiHarness({ cwd: workspaceRoot, sessionRoot })
      // Hydration must not throw, and creating a real session must still
      // work normally alongside the unresolvable registry entry.
      await expect(harness.sessions!.create(ctx, { title: 'New chat' })).resolves.toMatchObject({ id: 'scripted-main' })
    })
  })
})
