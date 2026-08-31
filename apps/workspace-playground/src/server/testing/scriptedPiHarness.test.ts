import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createScriptedPiHarness,
  isPlaygroundShowcaseSession,
  markPlaygroundShowcaseSession,
  readPlaygroundShowcaseRegistryForTest,
  sessionNamespaceAgentKey,
} from './scriptedPiHarness'

// Matches what ScriptedSessionStore itself computes when no `sessionNamespace`
// is passed (every existing test below, which predates agent-scoped
// provenance) — keeping tests honest against the real derivation instead of
// hardcoding the '(unscoped)' fallback string.
const UNSCOPED_AGENT_KEY = sessionNamespaceAgentKey(undefined)

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
      await markPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, ctx.workspaceId, showcaseSession.id)

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
      await markPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, ctx.workspaceId, session.id)
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
      await markPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, ctx.workspaceId, 'scripted-belongs-elsewhere')

      const harness = createScriptedPiHarness({ cwd: workspaceRoot, sessionRoot })
      // Hydration must not throw, and creating a real session must still
      // work normally alongside the unresolvable registry entry.
      await expect(harness.sessions!.create(ctx, { title: 'New chat' })).resolves.toMatchObject({ id: 'scripted-main' })
    })

    // gh-1458 review round 3: the previous "unresolvable entry" test above
    // proved hydration doesn't crash on a foreign id, but it left the entry
    // in the registry forever — retention, not pruning. This test proves
    // the actual exploit sequence the review described is closed: mark a
    // session, delete it exactly the way the pagehide cleanup path does
    // (through the ordinary delete route, i.e. `sessions.delete`), let a
    // later ordinary session recycle the freed numeric id, and confirm a
    // subsequent boot's sweep does NOT delete that unrelated ordinary
    // session.
    it('unmarks a session on delete, so its numeric id can be safely recycled by an ordinary session later', async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-recycle-workspace-'))
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-recycle-sessions-'))
      const input = { cwd: workspaceRoot, sessionRoot }
      const ctx = { workspaceId: 'workspace-a' }

      // Boot 1: create + mark a showcase session, then delete it — exactly
      // what the pagehide cleanup does for a session that never got a turn.
      const first = createScriptedPiHarness(input)
      const showcaseSession = await first.sessions!.create(ctx, { title: 'Navigation polish review' })
      expect(showcaseSession.id).toBe('scripted-main')
      await markPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, ctx.workspaceId, showcaseSession.id)
      await expect(isPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, ctx.workspaceId, showcaseSession.id)).resolves.toBe(true)
      await expect(readPlaygroundShowcaseRegistryForTest(sessionRoot)).resolves.toHaveProperty('size', 1)
      await first.sessions!.delete(ctx, showcaseSession.id)

      // Deletion must unmark immediately — not wait for a future sweep.
      await expect(isPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, ctx.workspaceId, showcaseSession.id)).resolves.toBe(false)
      await expect(readPlaygroundShowcaseRegistryForTest(sessionRoot)).resolves.toHaveProperty('size', 0)

      // Boot 2: createCount resets on hydrate, so an ordinary (unmarked)
      // session recycles the now-free 'scripted-main' id.
      const second = createScriptedPiHarness(input)
      const ordinarySession = await second.sessions!.create(ctx, { title: 'A developer’s real draft' })
      expect(ordinarySession.id).toBe('scripted-main')

      // Boot 3: if the stale registry entry had survived, this sweep would
      // now delete the ordinary session that happens to share its id.
      const third = createScriptedPiHarness(input)
      const afterBoot3 = await third.sessions!.list(ctx, { includeEmpty: true })
      expect(afterBoot3.map((session) => session.id)).toContain(ordinarySession.id)
      expect(afterBoot3.find((session) => session.id === ordinarySession.id)?.title).toBe('A developer’s real draft')
    })

    it('serializes concurrent marks so two overlapping requests both land in the registry', async () => {
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-concurrent-sessions-'))
      await Promise.all(
        Array.from({ length: 20 }, (_, index) => markPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, 'workspace-a', `scripted-concurrent-${index}`)),
      )
      const registry = await readPlaygroundShowcaseRegistryForTest(sessionRoot)
      expect(registry.size).toBe(20)
      for (let index = 0; index < 20; index += 1) {
        await expect(isPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, 'workspace-a', `scripted-concurrent-${index}`)).resolves.toBe(true)
      }
    })

    it('isPlaygroundShowcaseSession only recognizes ids this wrapper actually marked', async () => {
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-known-sessions-'))
      await expect(isPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, 'workspace-a', 'scripted-unmarked')).resolves.toBe(false)
      await markPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, 'workspace-a', 'scripted-marked')
      await expect(isPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, 'workspace-a', 'scripted-marked')).resolves.toBe(true)
      await expect(isPlaygroundShowcaseSession(sessionRoot, UNSCOPED_AGENT_KEY, 'workspace-a', 'scripted-unmarked')).resolves.toBe(false)
    })

    // gh-1458 review round 4: scripted session ids are only unique WITHIN
    // one namespaced store — 'alpha--<hash>' and 'beta--<hash>' each
    // independently allocate their own 'scripted-main'. A bare-id registry
    // would let a mark for one agent's session be read as provenance for
    // an unrelated session of the same id under a different agent. This is
    // the review's deterministic repro, reproduced directly: mark an empty
    // session under the 'alpha' namespace, create an ordinary (unmarked,
    // same-id) session under the 'beta' namespace sharing the same
    // sessionRoot (and therefore the same registry file), rehydrate the
    // beta store, and confirm beta's unrelated draft survives — the sweep
    // must never touch a different agent's records, no matter what bare id
    // they share.
    it('does not let a mark for one agent namespace sweep a same-id session in a different agent namespace', async () => {
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-cross-namespace-sessions-'))
      const alphaWorkspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-cross-namespace-alpha-workspace-'))
      const betaWorkspaceRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-cross-namespace-beta-workspace-'))
      const ctx = { workspaceId: 'workspace-a' }

      const alphaHarness = createScriptedPiHarness({
        cwd: alphaWorkspaceRoot,
        sessionRoot,
        sessionNamespace: 'alpha--scopehash',
      })
      const alphaSession = await alphaHarness.sessions!.create(ctx, { title: 'Navigation polish review' })
      expect(alphaSession.id).toBe('scripted-main')
      await markPlaygroundShowcaseSession(sessionRoot, 'alpha', ctx.workspaceId, alphaSession.id)

      const betaHarness = createScriptedPiHarness({
        cwd: betaWorkspaceRoot,
        sessionRoot,
        sessionNamespace: 'beta--scopehash',
      })
      // Ordinary, never-marked session that happens to independently
      // allocate the exact same bare id as alpha's marked one.
      const betaSession = await betaHarness.sessions!.create(ctx, { title: "Beta's real draft" })
      expect(betaSession.id).toBe('scripted-main')

      const betaRestarted = createScriptedPiHarness({
        cwd: betaWorkspaceRoot,
        sessionRoot,
        sessionNamespace: 'beta--scopehash',
      })
      const betaAfterRestart = await betaRestarted.sessions!.list(ctx, { includeEmpty: true })
      expect(betaAfterRestart).toContainEqual(expect.objectContaining({ id: betaSession.id, title: "Beta's real draft" }))

      // The alpha mark is untouched by beta's hydration/sweep — it belongs
      // to a different agent key and beta's store never even looks at it.
      await expect(isPlaygroundShowcaseSession(sessionRoot, 'alpha', ctx.workspaceId, alphaSession.id)).resolves.toBe(true)
      await expect(isPlaygroundShowcaseSession(sessionRoot, 'beta', ctx.workspaceId, betaSession.id)).resolves.toBe(false)
    })

    it('resumeSessionId validation is scoped per agent key: a mark under one agent is not recognized under another', async () => {
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-cross-namespace-resume-'))
      await markPlaygroundShowcaseSession(sessionRoot, 'alpha', 'workspace-a', 'scripted-main')
      await expect(isPlaygroundShowcaseSession(sessionRoot, 'alpha', 'workspace-a', 'scripted-main')).resolves.toBe(true)
      // Same bare session id, different agent key: must not be recognized —
      // this is exactly what dev.ts's wrapper route checks before ever
      // forwarding a client-supplied resumeSessionId for `targetAgentTypeId`.
      await expect(isPlaygroundShowcaseSession(sessionRoot, 'beta', 'workspace-a', 'scripted-main')).resolves.toBe(false)
    })

    // gh-1458 review round 5: agent-key scoping alone wasn't enough either.
    // The store is scoped by the FULL storage namespace
    // `<agentTypeId>--<hash(workspaceScopeId)>--...`, so the SAME agent
    // type under two different workspace scopes ('alpha--hashA' vs
    // 'alpha--hashB') is still two independent stores that each
    // independently allocate their own 'scripted-main' — a collision
    // agent-key-only scoping couldn't see. Reproduced directly: mark an
    // empty session under 'alpha' for one raw workspace id, create an
    // ordinary (unmarked, same-id) session under 'alpha' for a *different*
    // raw workspace id sharing the same sessionRoot/registry file,
    // rehydrate the second store, and confirm its unrelated draft survives.
    it('does not let a mark for one workspace scope sweep a same-agent, same-id session in a different workspace scope', async () => {
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-cross-workspace-sessions-'))
      const workspaceARoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-cross-workspace-a-workspace-'))
      const workspaceBRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-cross-workspace-b-workspace-'))
      const ctxA = { workspaceId: 'workspace-A' }
      const ctxB = { workspaceId: 'workspace-B' }

      // Same agent type ('alpha'), two different workspace-scope hash
      // suffixes — exactly what sessionNamespaceForAgent produces for the
      // same agent serving two different workspaces.
      const hashAHarness = createScriptedPiHarness({
        cwd: workspaceARoot,
        sessionRoot,
        sessionNamespace: 'alpha--hashA',
      })
      const hashASession = await hashAHarness.sessions!.create(ctxA, { title: 'Navigation polish review' })
      expect(hashASession.id).toBe('scripted-main')
      await markPlaygroundShowcaseSession(sessionRoot, 'alpha', ctxA.workspaceId, hashASession.id)

      const hashBHarness = createScriptedPiHarness({
        cwd: workspaceBRoot,
        sessionRoot,
        sessionNamespace: 'alpha--hashB',
      })
      // Ordinary, never-marked session under the SAME agent type but a
      // different workspace scope, independently allocating the same bare id.
      const hashBSession = await hashBHarness.sessions!.create(ctxB, { title: "Workspace B's real draft" })
      expect(hashBSession.id).toBe('scripted-main')

      const hashBRestarted = createScriptedPiHarness({
        cwd: workspaceBRoot,
        sessionRoot,
        sessionNamespace: 'alpha--hashB',
      })
      const hashBAfterRestart = await hashBRestarted.sessions!.list(ctxB, { includeEmpty: true })
      expect(hashBAfterRestart).toContainEqual(expect.objectContaining({ id: hashBSession.id, title: "Workspace B's real draft" }))

      // The workspace-A mark is untouched by workspace-B's hydration/sweep.
      await expect(isPlaygroundShowcaseSession(sessionRoot, 'alpha', ctxA.workspaceId, hashASession.id)).resolves.toBe(true)
      await expect(isPlaygroundShowcaseSession(sessionRoot, 'alpha', ctxB.workspaceId, hashBSession.id)).resolves.toBe(false)
    })

    it('resumeSessionId validation is scoped per workspace id too: a mark under one workspace is not recognized under another for the same agent', async () => {
      const sessionRoot = await mkdtemp(join(tmpdir(), 'scripted-pi-showcase-cross-workspace-resume-'))
      await markPlaygroundShowcaseSession(sessionRoot, 'alpha', 'workspace-A', 'scripted-main')
      await expect(isPlaygroundShowcaseSession(sessionRoot, 'alpha', 'workspace-A', 'scripted-main')).resolves.toBe(true)
      // Same agent key, same bare session id, different workspace id: must
      // not be recognized — this is exactly what dev.ts's wrapper route
      // checks (targetAgentTypeId + the raw x-boring-workspace-id header)
      // before ever forwarding a client-supplied resumeSessionId.
      await expect(isPlaygroundShowcaseSession(sessionRoot, 'alpha', 'workspace-B', 'scripted-main')).resolves.toBe(false)
    })
  })
})
