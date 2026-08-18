import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './fixtures'
import { createAgentPlaygroundRuntime } from '../../../apps/agent-playground/src/server/agentHost'
import { createPersistedScriptedPiHarness } from '../src/server/testing/scriptedPiHarness'
import { sessionFilePath } from '../src/server/harness/pi-coding-agent/__tests__/fixtures/sessionFiles'

const repoRoot = path.resolve(process.cwd(), '../..')

test.describe('Pi-native cross-hub continuation', () => {
  test('continues one session from a different hub root without forking or freezing', async ({ page, workspace }, testInfo) => {
    test.setTimeout(60_000)
    const firstRoot = path.join(workspace.root, 'hub-a')
    const secondRoot = path.join(workspace.root, 'hub-b')
    const sessionRoot = path.join(workspace.root, 'shared-sessions')
    await Promise.all([mkdir(firstRoot), mkdir(secondRoot), mkdir(sessionRoot)])

    const first = await createAgentPlaygroundRuntime({
      workspaceRoot: firstRoot,
      sessionRoot,
      harnessFactory: createPersistedScriptedPiHarness,
      logger: false,
    })
    const ref = await first.gateway.createSession({
      scope: first.scope,
      agentTypeId: 'default',
      requestId: 'hub-a-create',
    })
    const firstConnection = await first.gateway.connectSession({ scope: first.scope, ref })
    await firstConnection.send({
      kind: 'prompt',
      requestId: 'hub-a-prompt',
      clientNonce: 'hub-a-prompt',
      content: 'created in hub A',
    })
    await expect.poll(async () => (
      await first.gateway.readSessionState({ scope: first.scope, ref })
    ).state.messages.filter((message) => message.role === 'assistant').length).toBe(1)
    await firstConnection.close()
    await first.close()


    const second = await createAgentPlaygroundRuntime({
      workspaceRoot: secondRoot,
      sessionRoot,
      harnessFactory: createPersistedScriptedPiHarness,
      logger: false,
    })
    try {
      const before = await second.gateway.readSessionState({ scope: second.scope, ref })
      expect(before.ref).toEqual(ref)
      expect(before.state.messages.some((message) => message.role === 'user')).toBe(true)

      const secondConnection = await second.gateway.connectSession({ scope: second.scope, ref })
      const reply = (async () => {
        for await (const envelope of secondConnection.events) {
          expect(envelope.ref).toEqual(ref)
          if (JSON.stringify(envelope.event).includes('PI_NATIVE_ASSISTANT_DONE')) return true
        }
        return false
      })()
      await secondConnection.send({
        kind: 'prompt',
        requestId: 'hub-b-prompt',
        clientNonce: 'hub-b-prompt',
        content: 'continued in hub B',
      })
      await expect(Promise.race([
        reply,
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 15_000)),
      ])).resolves.toBe(true)
      await secondConnection.close()

      const after = await second.gateway.readSessionState({ scope: second.scope, ref })
      const listed = await second.gateway.listSessions({ scope: second.scope, agentTypeId: 'default' })
      expect(after.ref).toEqual(ref)
      expect(listed.sessions.map((session) => session.ref)).toEqual([ref])

      const transcriptPath = await sessionFilePath(path.join(sessionRoot, 'agent-playground'), ref.sessionId)
      const transcriptMessages = (await readFile(transcriptPath, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type?: string; id?: string; parentId?: string | null })
        .filter((entry) => entry.type === 'message')
      const transcriptIds = transcriptMessages.map((entry) => entry.id)
      const transcriptRoots = transcriptMessages.filter((entry) => entry.parentId === null)
      expect(new Set(transcriptIds).size).toBe(transcriptIds.length)
      expect(transcriptRoots).toHaveLength(1)

      const listedRefs = listed.sessions.map((session) => session.ref)
      const sameSessionRef = after.ref.agentTypeId === ref.agentTypeId
        && after.ref.sessionId === ref.sessionId
      const forked = listedRefs.length !== 1
        || listedRefs[0]?.agentTypeId !== ref.agentTypeId
        || listedRefs[0]?.sessionId !== ref.sessionId
      const proof = {
        firstHubRoot: firstRoot,
        secondHubRoot: secondRoot,
        sharedSessionRoot: sessionRoot,
        sessionId: ref.sessionId,
        userTurns: after.state.messages.filter((message) => message.role === 'user').length,
        persistedAssistantReplies: after.state.messages.filter((message) => message.role === 'assistant').length,
        liveReplyLandedOnSameRef: sameSessionRef,
        sessionsAfterContinuation: listed.sessions.length,
        forked,
        transcriptMessageIdsUnique: new Set(transcriptIds).size === transcriptIds.length,
        transcriptRoots: transcriptRoots.length,
      }
      expect(proof).toMatchObject({ liveReplyLandedOnSameRef: true, sessionsAfterContinuation: 1, forked: false, transcriptMessageIdsUnique: true, transcriptRoots: 1 })
      await page.setContent(`<!doctype html><title>Cross-hub continuation proof</title><style>body{font:16px ui-monospace;background:#111827;color:#e5e7eb;padding:40px}main{max-width:900px;margin:auto}h1{color:#86efac}pre{background:#030712;padding:24px;border:1px solid #374151;border-radius:12px;white-space:pre-wrap}</style><main><h1>✓ Same session continued across hub roots</h1><pre>${JSON.stringify(proof, null, 2)}</pre></main>`)
      const screenshot = await page.screenshot({ fullPage: true })
      const proofJson = Buffer.from(JSON.stringify(proof, null, 2))
      const handoffDir = path.join(repoRoot, '.handoff')
      await mkdir(handoffDir, { recursive: true })
      await Promise.all([
        writeFile(path.join(handoffDir, 'cross-hub-continuation.png'), screenshot),
        writeFile(path.join(handoffDir, 'cross-hub-continuation.json'), proofJson),
      ])
      await testInfo.attach('cross-hub-continuation.png', { body: screenshot, contentType: 'image/png' })
      await testInfo.attach('cross-hub-continuation.json', { body: proofJson, contentType: 'application/json' })
    } finally {
      await second.close()
    }
  })
})
