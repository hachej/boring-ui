import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, AssistantEntry, GenerationTask, configure, createRegistry, defineDocFamily, defineExtension, defineTask, defineTool, hook } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createOutputValidation } from '@hachej/boring-agent/validation';
import { createDocumentDelivery } from '@hachej/boring-agent/delivery';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';
import { createScriptedValidationModel } from './scripted-model.mjs';

const budgets = defineDocFamily({ kind: 'fixture.validated.repair-budget', version: 1, scope: 'session', family: true,
  initial: () => ({ evidence: [], answers: {}, attempts: 0, decisions: {} }) });
const requests = defineDocFamily({ kind: 'fixture.validated.requests', version: 1, scope: 'session', family: true,
  initial: () => ({ binding: null }) });
const identity = { principalId: 'fictional-editor', initiatorId: 'fictional-human', scopeId: 'fictional-team' };
const target = path => ({ resource: { providerId: 'validated-output', path }, view: { kind: 'published' } });
const textOf = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('');
const hash = value => createHash('sha256').update(value).digest('hex');

export async function openValidatedOutputFixture({ directory, scenario = 'repair', maxRepairs = 1,
  authorize = () => true, authorizeTool = () => true, authorizePublication = () => true,
  afterRepairDecision = async () => {}, afterAnswerEvidence = async () => {}, unrelatedEvidence = [] } = {}) {
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 8) throw new TypeError('maxRepairs must be an integer from 0 to 8');
  mkdirSync(directory, { recursive: true });
  const fake = createScriptedValidationModel();
  const provider = openSqliteWorkspaces({ filename: join(directory, 'resources.sqlite'), providerId: 'validated-output',
    authorize: (action, resource, actor) => ['read', 'lookup'].includes(action)
      || authorizePublication({ action, resource, actor }) === true });
  const registry = createRegistry();
  let harness, closing;
  const source = defineTool({ name: 'read_fictional_source', description: 'Read the fictional authorized source.', replay: 'safe',
    parameters: Type.Object({ resource: Type.Literal('fictional-source') }, { additionalProperties: false }),
    execute: async () => await authorizeTool('read_fictional_source') === true
      ? { content: [{ type: 'text', text: 'Fictional source: two plus two.' }] }
      : { isError: true, content: [{ type: 'text', text: 'Fictional source access denied' }] } });
  const calculator = defineTool({ name: 'calculate_fictional', description: 'Calculate the fictional sum.', replay: 'safe',
    parameters: Type.Object({ left: Type.Integer(), right: Type.Integer() }, { additionalProperties: false }),
    execute: async args => await authorizeTool('calculate_fictional') === true
      ? { content: [{ type: 'text', text: String(args.left + args.right) }] }
      : { isError: true, content: [{ type: 'text', text: 'Fictional calculation denied' }] } });
  const toolExtension = defineExtension({ name: 'fixture.validated.tools', tools: [source, calculator] });
  registry.install(toolExtension);
  let validation;
  const proposalEvidence = (input, evidence) => input.scenario === 'missing' ? [] : input.scenario === 'forged' ? [999999]
    : input.scenario === 'unrelated' ? [...input.unrelatedEvidence] : [...evidence];
  const generationHooks = defineExtension({ name: 'fixture.validated.generation-hooks', hooks: [hook(GenerationTask, {
    afterTools: async (_assistant, results, api) => {
      const child = await harness.conversation(api.conversationId, context);
      await child.commit(async tx => { (await tx.doc(budgets, String(api.conversationId), null)).evidence = [...results]; }, context);
    },
    onYield: async (answer, api) => {
      const child = await harness.conversation(api.conversationId, context);
      const record = await harness.commit(tx => tx.conversation(api.conversationId), context);
      const owner = record?.owner?.taskId;
      if (!owner) return;
      const original = await harness.getTask(owner, context);
      if (!original || original.kind !== producer.definition.name) return;
      const digest = hash(textOf(answer));
      const key = `${api.taskId}/${digest}`;
      const before = await harness.snapshot(budgets, String(api.conversationId), context);
      const evidence = before?.answers?.[key] ?? before?.evidence ?? [];
      const checked = await validation.check({ text: textOf(answer), evidence: proposalEvidence(original.input, evidence) }, owner, context);
      const decision = await child.commit(async tx => {
        const budget = await tx.doc(budgets, String(api.conversationId), null);
        if (!Object.hasOwn(budget.answers, key)) budget.answers[key] = [...evidence];
        if (checked.kind === 'valid') return null;
        if (Object.hasOwn(budget.decisions, key)) return { ...budget.decisions[key] };
        const grant = budget.attempts < original.input.maxRepairs;
        if (grant) budget.attempts++;
        const value = { generation: api.taskId, digest, continue: grant, used: budget.attempts };
        budget.decisions[key] = value;
        return value;
      }, context);
      await afterAnswerEvidence({ generation: api.taskId, conversationId: api.conversationId,
        digest, evidence: [...evidence], kind: checked.kind });
      if (decision === null) return;
      await afterRepairDecision(structuredClone(decision));
      return decision.continue ? { continue: 'Correct the fictional number to 4 using the original tool returns.' } : undefined;
    },
  })] });
  registry.install(generationHooks);
  const producer = defineTask({ name: 'fixture.validated.produce', version: 1, initial: () => ({ phase: 'start' }), phases: {
    start: async (running, runtime, ctx) => {
      await runtime.commit(async tx => {
        const child = await tx.createConversation({ ownership: { kind: 'task', taskId: runtime.taskId } });
        await configure(tx, child.id, { model: running.input.model, tools: [source, calculator], extensions: [toolExtension, generationHooks],
          instructions: running.input.instructions });
        return { status: 'running', checkpoint: { phase: 'generate', child: child.id } };
      }, ctx);
    },
    generate: async (running, runtime, ctx) => {
      const child = await runtime.conversation(running.state.checkpoint.child, ctx);
      if (!child) throw new Error('Owned generation conversation is missing');
      const submitted = await child.submit({ type: 'input', content: running.input.request, requestId: `validated:${runtime.taskId}` }, ctx);
      const settled = await submitted.wait(ctx);
      if (settled.status !== 'done') throw new Error('Fictional generation did not finish');
      const entry = await harness.commit(tx => tx.entry(AssistantEntry, settled.answer), ctx);
      const final = entry?.model?.[0];
      const budget = await runtime.snapshot(budgets, String(running.state.checkpoint.child), ctx);
      if (!final || final.role !== 'assistant') throw new Error('Native answer is missing');
      const answerKey = `${entry.byTaskId}/${hash(textOf(final))}`;
      const evidence = proposalEvidence(running.input, budget?.answers?.[answerKey] ?? []);
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: { text: textOf(final), evidence } } }), ctx);
    },
  }, abort: async (_running, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  const format = defineTask({ name: 'fixture.validated.format', version: 1, initial: () => ({ phase: 'wait' }), phases: {
    wait: async (running, runtime, ctx) => runtime.commit(() => ({ status: 'waiting', on: [running.input.validation], policy: 'allSettled', checkpoint: { phase: 'format' } }), ctx),
    format: async (running, runtime, ctx) => {
      const [outcome] = await runtime.outcomes([running.input.validation], ctx);
      const result = outcome?.status === 'completed' ? outcome.result : undefined;
      if (result?.kind !== 'valid') {
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'failed', error: { name: 'ValidationFailed', message: 'Fictional answer was not validated' } } }), ctx);
        return;
      }
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: `# Fictional validated output\n${result.value.label}: ${result.value.number}` } }), ctx);
    },
  }, abort: async (_running, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  try {
    harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: fake.models }, context);
    const conversation = await harness.root(context);
    validation = createOutputValidation({ name: 'fixture.validated.createOutputValidation', version: 1, harness: () => harness,
      authorize: async (_owner, evidence) => await authorize(evidence) === true,
      validate: (text, evidence) => {
        let value;
        try { value = JSON.parse(text); } catch { return { kind: 'invalid', errors: ['Invalid fictional JSON'] }; }
        const source = evidence.find(item => item.call.name === 'read_fictional_source');
        const calculated = evidence.find(item => item.call.name === 'calculate_fictional');
        const sum = calculated?.result.content.find(item => item.type === 'text')?.text;
        const sourceText = source?.result.content.find(item => item.type === 'text')?.text;
        if (value.number !== 4 || value.label !== 'Fictional answer' || sourceText !== 'Fictional source: two plus two.'
          || calculated?.call.arguments.left !== 2 || calculated.call.arguments.right !== 2 || sum !== '4') {
          return { kind: 'invalid', errors: ['Fictional answer lacks its required tool returns'] };
        }
        return { kind: 'valid', value: { number: value.number, label: value.label } };
      } });
    const delivery = createDocumentDelivery({ operationNamespace: 'fictional-validated-output', validationVersion: 'fictional-validated-v1',
      publisher: provider.publication, lookup: provider.reconciliation, replay: 'reconcile-only',
      resolveAccess: () => identity, validate: text => text.startsWith('# Fictional validated output\n') ? [] : ['Invalid fictional output'] });
    registry.install(defineExtension({ name: 'fixture.validated.tasks', tasks: [producer, format] }));
    registry.install(validation.extension);
    registry.install(delivery.extension);
    const output = target('output.md');
    const admit = async requestId => {
      const guard = target(`generation-${requestId}.json`);
      const input = { request: 'Create fictional validated output.', model: { ...fake.model },
        instructions: 'Use the source and calculator tools. Retain their original results.', scenario, maxRepairs,
        unrelatedEvidence: structuredClone(unrelatedEvidence), actor: { ...identity }, configuration: 'fictional-validation-v1' };
      const guarded = await provider.publication.publish({ operationId: `fixture.validated.guard:${requestId}`, atomicity: 'all-or-nothing', changes: [
        { kind: 'create', target: guard, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('fictional generation 1'), mediaType: 'application/json' },
      ] }, identity);
      if (guarded.kind !== 'committed') return { kind: guarded.kind };
      const guardRef = guarded.receipt.changes[0].after;
      const ref = await conversation.commit(async tx => {
        const doc = await tx.doc(requests, requestId, null);
        if (doc.binding) return JSON.parse(JSON.stringify(doc.binding));
        const producerId = await tx.createTask(producer, input, { ownership: { kind: 'conversation' } });
        const validationId = await tx.createTask(validation.task, { producer: producerId }, { ownership: { kind: 'conversation' } });
        const formatterId = await tx.createTask(format, { validation: validationId }, { ownership: { kind: 'conversation' } });
        const published = await delivery.admit(tx, () => Promise.resolve(formatterId),
          { kind: 'absent', target: output, preconditions: [{ kind: 'revision', target: guardRef }] },
          { ownership: { kind: 'conversation' } }, context, identity);
        const binding = { producer: producerId, validation: validationId, formatter: formatterId,
          delivery: published.delivery, operationId: published.operationId, guard: guardRef };
        doc.binding = binding;
        return structuredClone(binding);
      }, context);
      harness.resume();
      return { kind: 'admitted', ref };
    };
    return { admit, harness, conversation, provider, fake, budgets, target: { output },
      close: () => closing ??= (async () => { try { await harness.close(context); } finally { provider.close(); } })() };
  } catch (error) {
    if (harness) await harness.close(context);
    provider.close();
    throw error;
  }
}
