import { createHash, randomUUID } from 'node:crypto';
import { AssistantEntry, GenerationTask, configure, defineDocFamily, defineExtension, defineTask, defineTool, hook } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createOutputValidation } from '@hachej/boring-agent/validation';
import { createScriptedRedactionModel } from './scripted-model.mjs';

const catalogs = defineDocFamily({ kind: 'fixture.redaction.catalog', version: 1, scope: 'session', family: true,
  initial: () => ({ source: randomUUID(), calculation: randomUUID() }) });
const repairs = defineDocFamily({ kind: 'fixture.redaction.proposal-repairs', version: 1, scope: 'session', family: true,
  initial: () => ({ evidence: [], answers: {}, attempts: 0, decisions: {} }) });
const textOf = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('');
const digest = text => createHash('sha256').update(text).digest('hex');
const invalid = message => ({ kind: 'invalid', errors: [message] });

export function createRedactionProposals({ harness, allowed, beforeProduce = async () => {}, afterRepairDecision = async () => {} }) {
  const fake = createScriptedRedactionModel();
  const producerInput = async conversationId => {
    const record = await harness().commit(tx => tx.conversation(conversationId), context);
    const owner = record?.owner?.taskId;
    const task = owner && await harness().getTask(owner, context);
    if (!task || task.kind !== producer.definition.name) throw new Error('Original proposal producer is unavailable');
    return { owner, input: task.input };
  };
  const permitted = input => allowed(input.actor, 'execute') === true && allowed(input.actor, 'read', input.request.source) === true;
  const source = defineTool({ name: 'read_fictional_source', description: 'Read the original fictional source.', replay: 'safe',
    parameters: Type.Object({ resource: Type.Literal('original') }, { additionalProperties: false }),
    execute: async (_args, api) => {
      const { input } = await producerInput(api.conversationId);
      return permitted(input) ? { content: [{ type: 'text', text: input.text }] }
        : { isError: true, content: [{ type: 'text', text: 'Fictional source denied' }] };
    } });
  const calculator = defineTool({ name: 'calculate_fictional', description: 'Calculate the fictional sum.', replay: 'safe',
    parameters: Type.Object({ left: Type.Integer(), right: Type.Integer() }, { additionalProperties: false }),
    execute: async (args, api) => {
      const { input } = await producerInput(api.conversationId);
      return permitted(input) ? { content: [{ type: 'text', text: String(args.left + args.right) }] }
        : { isError: true, content: [{ type: 'text', text: 'Fictional calculation denied' }] };
    } });
  let validation;
  const proposedEvidence = (input, evidence) => input.settings.proposal.scenario === 'missing' ? []
    : input.settings.proposal.scenario === 'forged' ? [999999] : [...evidence];
  const generationHooks = [hook(GenerationTask, {
    afterTools: async (_assistant, results, api) => {
      const child = await harness().conversation(api.conversationId, context);
      await child.commit(async tx => { (await tx.doc(repairs, String(api.conversationId), null)).evidence = [...results]; }, context);
    },
    onYield: async (answer, api) => {
      const { owner, input } = await producerInput(api.conversationId);
      const child = await harness().conversation(api.conversationId, context);
      const answerDigest = digest(textOf(answer));
      const key = `${api.taskId}/${answerDigest}`;
      const before = await harness().snapshot(repairs, String(api.conversationId), context);
      const evidence = before?.answers?.[key] ?? before?.evidence ?? [];
      const checked = await validation.check({ text: textOf(answer), evidence: proposedEvidence(input, evidence) }, owner, context);
      const decision = await child.commit(async tx => {
        const budget = await tx.doc(repairs, String(api.conversationId), null);
        if (!Object.hasOwn(budget.answers, key)) budget.answers[key] = [...evidence];
        if (checked.kind === 'valid') return null;
        if (Object.hasOwn(budget.decisions, key)) return { ...budget.decisions[key] };
        const grant = budget.attempts < input.settings.proposal.maxRepairs;
        if (grant) budget.attempts++;
        const value = { generation: api.taskId, digest: answerDigest, continue: grant, used: budget.attempts };
        budget.decisions[key] = value;
        return value;
      }, context);
      if (!decision) return;
      await afterRepairDecision(structuredClone(decision));
      return decision.continue ? { continue: 'Correct the fictional calculation to 4 using the original tool returns.' } : undefined;
    },
  })];
  const producer = defineTask({ name: 'fixture.redaction.proposal', version: 1, initial: () => ({ phase: 'start' }), phases: {
    start: async (running, runtime, ctx) => {
      await beforeProduce(structuredClone(running.input));
      if (!permitted(running.input)) throw new Error('Original fictional source execution is no longer authorized');
      await runtime.commit(async tx => {
        const child = await tx.createConversation({ ownership: { kind: 'task', taskId: runtime.taskId } });
        await configure(tx, child.id, { model: running.input.model, tools: [source, calculator], extensions: [extension] });
        return { status: 'running', checkpoint: { phase: 'generate', child: child.id } };
      }, ctx);
    },
    generate: async (running, runtime, ctx) => {
      if (!permitted(running.input)) throw new Error('Original fictional source execution is no longer authorized');
      const child = await runtime.conversation(running.state.checkpoint.child, ctx);
      if (!child) throw new Error('Owned proposal conversation is missing');
      const request = JSON.stringify({ subject: running.input.request.subject, text: running.input.text,
        catalog: running.input.catalog, settings: running.input.settings });
      const submitted = await child.submit({ type: 'input', content: request, requestId: `redaction:${runtime.taskId}` }, ctx);
      const settled = await submitted.wait(ctx);
      if (settled.status !== 'done') throw new Error('Fictional proposal generation did not finish');
      const entry = await harness().commit(tx => tx.entry(AssistantEntry, settled.answer), ctx);
      const final = entry?.model?.[0];
      if (!final || final.role !== 'assistant') throw new Error('Native proposal answer is missing');
      const budget = await runtime.snapshot(repairs, String(running.state.checkpoint.child), ctx);
      const key = `${entry.byTaskId}/${digest(textOf(final))}`;
      const evidence = proposedEvidence(running.input, budget?.answers?.[key] ?? []);
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed',
        result: { text: textOf(final), evidence } } }), ctx);
    },
  }, abort: async (_running, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  validation = createOutputValidation({ name: 'fixture.redaction.proposal-validation', version: 1, harness,
    authorize: async owner => {
      const task = await harness().getTask(owner, context);
      return !!task && task.kind === producer.definition.name && allowed(task.input.actor, 'validate') === true
        && permitted(task.input);
    },
    validate: async (text, evidence) => {
      const { input } = await producerInput(evidence[0].conversationId);
      let answer;
      try { answer = JSON.parse(text); } catch { return invalid('Invalid fictional proposal JSON'); }
      const order = input.settings.proposal.order;
      if (!answer || Object.keys(answer).join(',') !== 'items' || !Array.isArray(answer.items)
        || answer.items.length !== order.length) return invalid('Fictional proposal items do not match the original order');
      const byName = new Map(evidence.map(item => [item.call.name, item]));
      if (evidence.length !== 2 || byName.size !== 2) return invalid('Both original tool returns are required');
      const read = byName.get('read_fictional_source');
      const calculated = byName.get('calculate_fictional');
      if (!read || !calculated || read.call.arguments.resource !== 'original'
        || read.result.content.length !== 1 || read.result.content[0]?.type !== 'text'
        || read.result.content[0].text !== input.text
        || calculated.call.arguments.left !== 2 || calculated.call.arguments.right !== 2
        || calculated.result.content.length !== 1 || calculated.result.content[0]?.type !== 'text'
        || calculated.result.content[0].text !== '4') return invalid('Original source and calculation returns are required');
      const items = [];
      for (let index = 0; index < order.length; index++) {
        const item = answer.items[index];
        const kind = order[index];
        if (!item || Object.keys(item).sort().join(',') !== 'kind,text' || item.kind !== kind
          || item.text !== (kind === 'source' ? input.text : '4')) return invalid('Fictional item differs from its tool return');
        items.push({ itemId: input.catalog[kind], text: item.text });
      }
      return { kind: 'valid', value: { items } };
    } });
  const format = defineTask({ name: 'fixture.redaction.proposal-format', version: 1, initial: () => ({ phase: 'wait' }), phases: {
    wait: async (running, runtime, ctx) => runtime.commit(() => ({ status: 'waiting', on: [running.input.validation], policy: 'allSettled', checkpoint: { phase: 'format' } }), ctx),
    format: async (running, runtime, ctx) => {
      const [outcome] = await runtime.outcomes([running.input.validation], ctx);
      const result = outcome?.status === 'completed' ? outcome.result : undefined;
      if (result?.kind !== 'valid') {
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'failed',
          error: { name: 'ValidationFailed', message: 'Fictional proposal was not validated' } } }), ctx);
        return;
      }
      const text = `# Fictional ${running.input.request.subject}\n${result.value.items.map(item => item.text).join('\n')}`;
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: text } }), ctx);
    },
  }, abort: async (_running, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  const extension = defineExtension({ name: 'fixture.redaction.proposals', tasks: [producer, format],
    tools: [source, calculator], hooks: generationHooks });
  const catalog = async (tx, subject) => {
    if (!['A', 'B', 'C'].includes(subject)) throw new TypeError('Unknown fictional subject');
    const record = await tx.doc(catalogs, subject, null);
    return { source: record.source, calculation: record.calculation };
  };
  const admit = async (tx, input) => {
    const producerId = await tx.createTask(producer, structuredClone(input), { ownership: { kind: 'conversation' } });
    const validationId = await tx.createTask(validation.task, { producer: producerId }, { ownership: { kind: 'conversation' } });
    const formatterId = await tx.createTask(format, { validation: validationId, actor: structuredClone(input.actor),
      request: structuredClone(input.request) }, { ownership: { kind: 'conversation' } });
    return { producer: producerId, validation: validationId, formatter: formatterId };
  };
  return { models: fake.models, model: fake.model, fake, extension, producer, validation, format, catalog, admit, repairs };
}
