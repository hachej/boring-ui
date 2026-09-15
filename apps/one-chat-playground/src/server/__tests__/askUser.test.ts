import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test } from 'vitest'

import { PENDING_QUESTIONS_ROUTE, createAskUser, type PendingQuestionView } from '../askUser'

const apps: FastifyInstance[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
})

const QUESTION = {
  title: 'Should I delete the old orders?',
  context: 'There are 412 orders from before last year.',
  schema: {
    wireVersion: 1,
    fields: [{
      type: 'radio',
      name: 'choice',
      label: 'What should happen',
      options: [
        { value: 'delete', label: 'Delete them for good' },
        { value: 'hide', label: 'Just hide them' },
      ],
    }],
  },
}

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'one-chat-ask-'))
  const askUser = createAskUser({
    statePath: path.join(dir, 'ask-user.json'),
    agentTypeId: 'default',
    defaultSessionId: 'one-chat',
  })
  const app = Fastify({ logger: false })
  apps.push(app)
  await askUser.registerRoutes(app)
  await app.ready()

  const pending = async (): Promise<PendingQuestionView[]> => {
    const response = await app.inject({ method: 'GET', url: PENDING_QUESTIONS_ROUTE })
    return (response.json() as { questions: PendingQuestionView[] }).questions
  }
  const waitForQuestion = async (): Promise<PendingQuestionView> => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const [first] = await pending()
      if (first) return first
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('no question was published')
  }
  const ask = (toolCallId = 'call-1', signal?: AbortSignal) =>
    askUser.tool.execute(QUESTION, {
      toolCallId,
      abortSignal: signal ?? new AbortController().signal,
      sessionId: 'one-chat',
    })
  const submit = (question: PendingQuestionView, values: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/questions/commands',
      payload: {
        kind: 'questions.submit',
        params: {
          questionId: question.questionId,
          sessionId: question.sessionId,
          answerToken: question.answerToken,
          values,
        },
      },
    })

  return { app, askUser, pending, waitForQuestion, ask, submit, statePath: path.join(dir, 'ask-user.json') }
}

describe('the inline question', () => {
  test('blocks the turn until the user answers, then hands the answer back', async () => {
    const { waitForQuestion, ask, submit } = await fixture()
    const turn = ask('call-1')
    let settled = false
    void turn.then(() => { settled = true })

    const question = await waitForQuestion()
    expect(question.toolCallId).toBe('call-1')
    expect(question.title).toBe(QUESTION.title)
    expect(question.schema?.fields[0]?.name).toBe('choice')
    expect(settled).toBe(false)

    const response = await submit(question, { choice: 'hide' })
    expect(response.statusCode).toBe(200)

    const result = await turn
    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toContain('User answered')
    expect(result.content[0]?.text).toContain('hide')
  })

  test('drops off the pending list once answered', async () => {
    const { waitForQuestion, ask, submit, pending } = await fixture()
    const turn = ask('call-1')
    const question = await waitForQuestion()
    await submit(question, { choice: 'delete' })
    await turn
    expect(await pending()).toEqual([])
  })

  test('refuses an answer that does not carry the question\'s own token', async () => {
    const { waitForQuestion, ask, submit } = await fixture()
    const turn = ask('call-1')
    const question = await waitForQuestion()
    const response = await submit({ ...question, answerToken: 'guessed' }, { choice: 'delete' })
    expect(response.statusCode).toBe(403)
    await submit(question, { choice: 'delete' })
    await turn
  })

  test('rejects a value that is not one of the offered options', async () => {
    const { waitForQuestion, ask, submit } = await fixture()
    const turn = ask('call-1')
    const question = await waitForQuestion()
    const response = await submit(question, { choice: 'something-else' })
    expect(response.statusCode).toBe(400)
    await submit(question, { choice: 'delete' })
    await turn
  })

  test('ends the turn when it is aborted, instead of hanging forever', async () => {
    const { waitForQuestion, ask, pending } = await fixture()
    const controller = new AbortController()
    const turn = ask('call-1', controller.signal)
    await waitForQuestion()
    controller.abort()
    const result = await turn
    expect(result.content[0]?.text).toContain('cancelled')
    expect(await pending()).toEqual([])
  })

  test('retires a question left pending by a previous run', async () => {
    const first = await fixture()
    const turn = first.ask('call-1')
    await first.waitForQuestion()
    await first.app.close()

    // Same state file, new process: the waiter is gone, so the card must not
    // come back to a user who could never resolve it.
    const askUser = createAskUser({ statePath: first.statePath, agentTypeId: 'default', defaultSessionId: 'one-chat' })
    const app = Fastify({ logger: false })
    apps.push(app)
    await askUser.registerRoutes(app)
    const response = await app.inject({ method: 'GET', url: PENDING_QUESTIONS_ROUTE })
    expect(response.json()).toEqual({ questions: [] })
    // The first process's waiter died with it; that promise is deliberately
    // abandoned, which is exactly why the record had to be retired.
    void turn.catch(() => undefined)
  })

  test('tells the model plainly when the question is malformed', async () => {
    const { askUser } = await fixture()
    const result = await askUser.tool.execute(
      { title: 'No fields' },
      { toolCallId: 'call-x', abortSignal: new AbortController().signal, sessionId: 'one-chat' },
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Invalid ask_user input')
  })
})
