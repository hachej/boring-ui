import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createQuestions } from '@hachej/boring-agent/questions';

const [directory, phase, state] = process.argv.slice(2);
const questions = createQuestions({ runtimeId: 'fictional-runtime', authorize: () => ({ principalId: 'reviewer', scopeId: 'cabinet' }), isCurrent: () => true });
const registry = createRegistry();
registry.install(questions.extension);
const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
const conversation = await harness.root(context);
const resolve = ref => conversation.commit(tx => questions.resolve(tx, ref, { resolutionId: 'resolution-one', answer: 'brief' }, context), context);
const consume = (ref, consumer) => conversation.commit(tx => questions.consume(tx, ref, 'resolution-one', consumer, context), context);
if (phase === 'hold') {
  const ref = await conversation.commit(tx => questions.admit(tx, {
    conversationId: conversation.id, questionId: 'format', scopeId: 'cabinet', subjectDigest: 'draft-v1', policyVersion: 'policy-v1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), prompt: 'Fictional format?', choices: ['brief', 'detailed'],
  }, { kind: 'conversation' }, context), context);
  if (state !== 'pending') await resolve(ref);
  if (state === 'consumed') await consume(ref, 'report-one');
  if (state === 'pending') {
    harness.resume();
    while ((await harness.getTask(ref.taskId, context)).state.status !== 'running') await delay(5);
  }
  const task = await harness.getTask(ref.taskId, context);
  writeFileSync(join(directory, 'ready.json'), JSON.stringify({ ref, task }));
  setInterval(() => {}, 1000);
  await new Promise(() => {});
} else {
  const { ref } = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  const before = await harness.snapshot(questions.documents, questions.documentKey(ref), context);
  const answer = await resolve(ref);
  const terminal = await harness.waitForTask(ref.taskId, context);
  const sameConsumer = await consume(ref, 'report-one');
  const otherConsumer = await consume(ref, 'report-two');
  writeFileSync(join(directory, 'recovered.json'), JSON.stringify({ before, answer, terminal, sameConsumer, otherConsumer }));
  await harness.close(context);
}
