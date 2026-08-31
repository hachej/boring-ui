import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { formatLogs, spawnBackend, type SpawnedBackend } from './helpers/backend'
import { createE2eWorkspace } from './helpers/workspace'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test.describe('durable paused-human restart (#1348)', () => {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    test(`keeps ask_user ready across ${signal} and answers idempotently`, async ({ request }, testInfo) => {
      test.setTimeout(90_000)
      const workspace = await createE2eWorkspace()
      const sessionRoot = path.join(workspace.root, '.pi-sessions')
      const env = {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
        BORING_AGENT_SESSION_ROOT: sessionRoot,
      }
      let backend: SpawnedBackend | undefined

      try {
        backend = await spawnBackend({ workspaceRoot: workspace.root, repoRoot, env, host: 'workspace' })

        const sessions = await bridgeJson<{ sessions: Array<{ ref: { sessionId: string } }> }>(
          request,
          backend.apiUrl,
          '/api/v1/agents/default/sessions',
        )
        let sessionId = sessions.sessions[0]?.ref.sessionId
        if (!sessionId) {
          const created = await request.post(`${backend.apiUrl}/api/v1/agents/default/sessions`, {
            data: { title: 'Paused human restart' },
          })
          expect(created.ok(), await created.text()).toBe(true)
          sessionId = (await created.json() as { ref: { sessionId: string } }).ref.sessionId
        }
        expect(sessionId).toBeTruthy()

        const prompt = await request.post(
          `${backend.apiUrl}/api/v1/agents/default/sessions/${encodeURIComponent(sessionId!)}/prompt`,
          {
            data: {
              requestId: `paused-${signal.toLowerCase()}`,
              clientNonce: `paused-${signal.toLowerCase()}`,
              content: 'ASK_USER_E2E',
            },
          },
        )
        expect(prompt.status()).toBe(202)

        const ready = await waitForPending(request, backend.apiUrl, sessionId!)
        expect(ready.status).toBe('ready')

        const fixedPort = backend.port
        await backend.kill(signal)
        backend = await spawnBackend({
          workspaceRoot: workspace.root,
          repoRoot,
          env,
          port: fixedPort,
          host: 'workspace',
        })

        const afterRestart = await waitForPending(request, backend.apiUrl, sessionId!)
        expect(afterRestart).toMatchObject({ questionId: ready.questionId, status: 'ready' })

        const answerInput = {
          questionId: ready.questionId,
          sessionId,
          answerToken: ready.answerToken,
          values: { choice: 'continue' },
        }
        const idempotencyKey = createHash('sha256')
          .update(JSON.stringify(['ask-user.v1.answer', answerInput]))
          .digest('hex')
        const first = await callBridge(request, backend.apiUrl, sessionId!, 'ask-user.v1.answer', answerInput, idempotencyKey)
        const second = await callBridge(request, backend.apiUrl, sessionId!, 'ask-user.v1.answer', answerInput, idempotencyKey)
        expect(first).toEqual({ ok: true, status: 'answered' })
        expect(second).toEqual(first)

        const answered = await pending(request, backend.apiUrl, sessionId!)
        expect(answered).toBeNull()
      } finally {
        if (backend) {
          await testInfo.attach('backend-combined.log', {
            body: Buffer.from(formatLogs(backend.logs), 'utf8'),
            contentType: 'text/plain',
          })
          await backend.stop()
        }
        await workspace.cleanup()
      }
    })
  }
})

type PendingQuestion = {
  questionId: string
  sessionId: string
  status: string
  answerToken: string
}

async function bridgeJson<T>(request: Parameters<typeof callBridge>[0], apiUrl: string, pathname: string): Promise<T> {
  const response = await request.get(`${apiUrl}${pathname}`)
  expect(response.ok()).toBe(true)
  return await response.json() as T
}

async function pending(request: Parameters<typeof callBridge>[0], apiUrl: string, sessionId: string): Promise<PendingQuestion | null> {
  const output = await callBridge(request, apiUrl, sessionId, 'ask-user.v1.pending', { sessionId }) as { pending: PendingQuestion | null }
  return output.pending
}

async function waitForPending(request: Parameters<typeof callBridge>[0], apiUrl: string, sessionId: string): Promise<PendingQuestion> {
  let question: PendingQuestion | null = null
  await expect.poll(async () => {
    question = await pending(request, apiUrl, sessionId)
    return question?.status
  }, { timeout: 15_000 }).toBe('ready')
  return question!
}

async function callBridge(
  request: import('@playwright/test').APIRequestContext,
  apiUrl: string,
  sessionId: string,
  op: string,
  input: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<unknown> {
  const response = await request.post(`${apiUrl}/api/v1/workspace-bridge/call`, {
    headers: {
      'x-csrf-token': 'browser',
      'x-boring-session-id': sessionId,
    },
    data: { op, input, ...(idempotencyKey ? { idempotencyKey } : {}) },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const body = await response.json() as { ok: boolean; output?: unknown }
  expect(body.ok).toBe(true)
  return body.output
}
