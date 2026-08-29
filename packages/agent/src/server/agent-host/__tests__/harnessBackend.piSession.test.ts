import { expect } from 'vitest'
import type { AgentCoreHarness } from '../../../shared/harness'
import type { SessionCtx, SessionStore } from '../../../shared/session'
import { createScriptedPiHarness } from '../../testing/scriptedPiHarness'
import { captureReadStateRequestContexts } from '../harnessBackend/__tests__/requestContextCapture'
import { createPiSessionHarnessBackend } from '../harnessBackend/piSessionHarnessBackend'
import { harnessBackendConformance } from '../testing/harnessBackendConformance'

function createWorkspaceScopedScriptedHarness(): AgentCoreHarness {
  const harnesses = new Map<string, ReturnType<typeof createScriptedPiHarness>>()
  const harnessFor = (ctx: SessionCtx) => {
    const key = ctx.workspaceId ?? ''
    let harness = harnesses.get(key)
    if (!harness) {
      harness = createScriptedPiHarness({ tools: [], cwd: `/workspace/${key}` })
      harnesses.set(key, harness)
    }
    return harness
  }
  const sessions: SessionStore = {
    list: (ctx, options) => harnessFor(ctx).sessions.list(ctx, options),
    create: (ctx, init) => harnessFor(ctx).sessions.create(ctx, init),
    load: (ctx, sessionId) => harnessFor(ctx).sessions.load(ctx, sessionId),
    delete: (ctx, sessionId) => harnessFor(ctx).sessions.delete(ctx, sessionId),
  }
  return {
    id: 'workspace-scoped-scripted-pi',
    placement: 'server',
    sessions,
    async getPiSessionAdapter(sendInput, runContext) {
      return await harnessFor(runContext.sessionCtx ?? {}).getPiSessionAdapter(sendInput, runContext)
    },
  }
}

harnessBackendConformance({
  name: 'pi-session',
  createBackend() {
    const harness = createWorkspaceScopedScriptedHarness()
    return {
      backend: createPiSessionHarnessBackend({
        harness,
        sessionStore: harness.sessions,
        workdir: '/workspace',
      }),
    }
  },
  async assertRequestContextSnapshot(fixture) {
    const created = await fixture.backend.createSession(
      { workspaceScopeId: 'workspace-context', agentTypeId: 'alpha' },
      { requestId: 'create-context', authSubjectId: 'subject-context' },
    )
    const observed = await captureReadStateRequestContexts(async () => {
      await fixture.backend.readSnapshot({
        workspaceScopeId: 'workspace-context',
        ref: { agentTypeId: 'alpha', sessionId: created.id },
      }, {
        requestId: 'snapshot-context',
        authSubjectId: 'subject-context',
      })
    })
    expect(observed).toEqual([{
      workspaceId: 'workspace-context',
      storageScope: 'workspace-context',
      authSubject: 'subject-context',
      sessionAuthority: 'workspace-scope',
      requestId: 'snapshot-context',
    }])
  },
})
