import { Harness, MemoryStorage, createRegistry, defineExtension, defineTask } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createQuestions } from '@hachej/boring-agent/questions';
import { createDocumentDelivery } from '@hachej/boring-agent/delivery';
import { openSqliteWorkspaces } from './shared/sqlite-workspaces.mjs';

const access = { principalId: 'fictional-editor', scopeId: 'fictional-cabinet', initiatorId: 'fictional-reviewer' };
const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
const questions = createQuestions({ runtimeId: 'background-example', authorize: () => access, isCurrent: () => true });
const delivery = createDocumentDelivery({ operationNamespace: 'background-example', validationVersion: 'heading-v1',
  publisher: provider.publication, lookup: provider.reconciliation, resolveAccess: () => access,
  validate: text => text.startsWith('# ') ? [] : ['A report heading is required'] });
const producer = defineTask({ name: 'example.report', version: 1, initial: () => ({ phase: 'wait' }), phases: {
  wait: async (task, runtime, ctx) => runtime.commit(() => ({ status: 'waiting', on: [task.input.question.taskId], policy: 'allSettled', checkpoint: { phase: 'produce' } }), ctx),
  produce: async (task, runtime, ctx) => runtime.commit(async tx => {
    const answer = await questions.consume(tx, task.input.question, 'fictional-answer', String(runtime.taskId), ctx);
    if (answer.kind !== 'resolved') throw new Error(`Question consumption: ${answer.kind}`);
    return { status: 'terminal', outcome: { status: 'completed', result: `# Fictional report\n\nRequested format: ${answer.answer}.\n` } };
  }, ctx),
}, abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
const registry = createRegistry();
registry.install(questions.extension);
registry.install(delivery.extension);
registry.install(defineExtension({ name: 'example.report', tasks: [producer] }));
const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
try {
  const conversation = await harness.root(context);
  const admitted = await conversation.commit(async tx => {
    const question = await questions.admit(tx, { conversationId: conversation.id, questionId: 'report-format', scopeId: access.scopeId,
      subjectDigest: 'fictional-report-v1', policyVersion: 'fixture-policy-v1', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      prompt: 'Choose a report format', choices: ['brief', 'detailed'] }, { kind: 'conversation' }, context);
    const binding = await delivery.admit(tx, inner => inner.createTask(producer, { question }, { ownership: { kind: 'conversation' } }),
      { kind: 'absent', target: { resource: { providerId: 'documents', path: 'report.md' }, view: { kind: 'published' } } },
      { ownership: { kind: 'conversation' } }, context);
    return { question, binding };
  }, context);
  await conversation.commit(tx => questions.resolve(tx, admitted.question, { resolutionId: 'fictional-answer', answer: 'brief' }, context), context);
  const terminal = await harness.waitForTask(admitted.binding.delivery, context);
  if (terminal.state.outcome.status !== 'completed' || terminal.state.outcome.result.kind !== 'committed') throw new Error(JSON.stringify(terminal.state.outcome));
  console.log(JSON.stringify({ questionTask: admitted.question.taskId, ...admitted.binding, result: terminal.state.outcome.result }, null, 2));
} finally {
  await harness.close(context);
  provider.close();
}
