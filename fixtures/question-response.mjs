import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createQuestions } from '@hachej/boring-agent/questions';
import { createQuestionResponseHandler } from '@hachej/boring-agent/question-response';

const questions = createQuestions({ runtimeId: 'fictional-runtime',
  authorize: () => ({ principalId: 'fictional-human', scopeId: 'example' }), isCurrent: () => true });
const registry = createRegistry(); registry.install(questions.extension);
const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
try {
  const conversation = await harness.root(context);
  const ref = await conversation.commit(tx => questions.admit(tx, { conversationId: conversation.id, questionId: 'format', scopeId: 'example',
    subjectDigest: 'fictional-draft-one', policyVersion: 'fictional-policy-one', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    prompt: 'Choose a fictional report format', choices: ['brief', 'detailed'] }, { kind: 'conversation' }, context), context);
  const handler = createQuestionResponseHandler({ authenticateHuman: async request => request.headers.get('authorization') === 'Bearer fictional-demo-token'
    ? { conversation, questions, ref, context, revoked: new AbortController().signal } : null });
  const response = await handler(new Request('https://fictional.invalid/questions/format', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer fictional-demo-token' },
    body: JSON.stringify({ schema: 'boring.question-response', version: 1, target: ref, resolutionId: 'fictional-answer-one', answer: 'brief' }) }));
  console.log(response.status, await response.json());
  console.log('Native task outcome:', (await harness.waitForTask(ref.taskId, context)).state.outcome);
  console.log('Fictional in-process authentication only; no network or human identity-provider qualification.');
} finally { await harness.close(context); }
