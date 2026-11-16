// Probe host-probe-tool-round-end: can a turn end when one call of a tool round expires and another call of the same round succeeds.
// Scripted model only, pi-durable 1.5.2 as installed, public exports only. Prints one JSON row per (seam, shape).
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, GenerationTask, LiveDoc, MemoryStorage, createRegistry, defineExtension, defineTool, hook } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { requireApproval } from '@hachej/boring-agent/approval';

const QUESTION_MS = 1000, FOLLOW_UP_MS = 500, FOLLOW = 'FOLLOW-UP from the other person';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = value => ({ isError: false, output: [{ type: 'text', text: value }] });
const textOf = message => (typeof message.content === 'string' ? message.content : message.content.filter(p => p.type === 'text').map(p => p.text).join(''));

const SHAPES = {
  a: ['post1'],
  b: ['post1', 'post2'],
  c1: ['post1', 'read'],
  c2: ['post1', 'delegate'],
  d: ['post1', 'post2'], // extra: post1 is approved at 300 ms, post2 expires
};
const SEAMS = ['none', 'terminate-naive', 'terminate-barrier', 'maxTurns-continue', 'maxTurns-keep', 'afterTools-hook-continue'];

function scriptedModels(shape, log) {
  const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'parent' }, { id: 'child' }] });
  const respond = (transcript, _options, _state, model) => {
    if (model.id === 'child') return fauxAssistantMessage([fauxText('Child: nothing to report.')]);
    const messages = transcript.messages;
    const results = messages.filter(m => m.role === 'toolResult');
    const followUp = messages.some(m => m.role === 'user' && textOf(m).includes(FOLLOW));
    const n = log.requests.length + 1;
    log.requests.push({ n, at: Date.now(), expired: results.some(r => textOf(r).startsWith('Expired:')), followUp, results: results.length });
    if (!results.length && !followUp) {
      const calls = SHAPES[shape].map(name => name === 'delegate'
        ? fauxToolCall('delegate', { task: 'Look something up.' }, { id: 'c-delegate' })
        : name === 'read' ? fauxToolCall('read', { topic: 'x' }, { id: 'c-read' })
        : fauxToolCall('post', { note: name }, { id: `c-${name}` }));
      return fauxAssistantMessage(calls, { stopReason: 'toolUse' });
    }
    return fauxAssistantMessage([fauxText(`R${n}: answer`)]);
  };
  faux.setResponses(Array.from({ length: 30 }, () => respond));
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

const postTool = defineTool({ name: 'post', description: 'Post a note (needs approval).', parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }, replay: 'safe', execute: async () => text('posted') });
const readTool = defineTool({ name: 'read', description: 'Read a fact.', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] }, replay: 'safe', execute: async () => text('fact') });

async function runCase(seam, shape) {
  const log = { requests: [], events: [] };
  const state = { ended: false, gated: new Map(), followUpSent: false, followUp: undefined, expiredAt: [], conversation: undefined };
  const stamp = event => log.events.push([Date.now(), event]);
  const terminates = seam === 'terminate-naive' || seam === 'terminate-barrier';
  const withControl = result => (terminates && state.ended ? { ...result, control: { terminate: true } } : result);

  const gatedWrap = tool => {
    const approved = requireApproval(tool, { summarize: args => `post ${args.note}` });
    return {
      ...approved,
      execute: async (args, api, ctx) => {
        let release; state.gated.set(api.callId, new Promise(resolve => { release = resolve; }));
        stamp(`question ${api.callId}`);
        if (!state.followUpSent) {
          state.followUpSent = true;
          setTimeout(async () => { state.followUp = await state.conversation.submit({ type: 'input', requestId: 'follow', content: FOLLOW, whenBusy: 'followUp' }, context); stamp('follow-up queued'); }, FOLLOW_UP_MS);
        }
        if (shape === 'd' && args.note === 'post1') setTimeout(() => answerUserQuestion(state.conversation, api.callId, 'Approve', ctx), 300);
        const inner = approved.execute(args, api, ctx);
        const expired = Symbol('expired');
        let timer; const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(expired), QUESTION_MS); });
        const first = await Promise.race([inner, timeout]);
        clearTimeout(timer);
        if (first !== expired) { release(); await roundHold(api, ctx); return withControl(first); }
        state.ended = true;
        await answerUserQuestion(state.conversation, api.callId, 'Deny', ctx);
        await inner;
        if (seam.startsWith('maxTurns')) await state.conversation.configure({ maxTurns: 1 }, context);
        state.expiredAt.push(Date.now());
        stamp(`expired ${api.callId}`);
        release();
        return withControl({ isError: true, output: [{ type: 'text', text: 'Expired: nobody answered; the turn ended.' }] });
      },
    };
  };
  const roundHold = async (api, ctx) => {
    if (seam !== 'terminate-barrier') return;
    const slots = (await api.snapshot(LiveDoc, api.conversationId, ctx))?.tools ?? [];
    const gatedNames = slots.filter(slot => slot.name === 'post').map(slot => slot.callId);
    const deadline = Date.now() + 3000;
    while (gatedNames.some(id => !state.gated.has(id)) && Date.now() < deadline) await sleep(5);
    await Promise.all(gatedNames.map(id => state.gated.get(id)));
  };
  const plainWrap = tool => ({ ...tool, execute: async (args, api, ctx) => { const result = await tool.execute(args, api, ctx); await roundHold(api, ctx); return withControl(result); } });

  const researcher = defineAgent({ id: 'researcher', struggle: false, model: { provider: 'fictional-faux', modelId: 'child' }, instructions: 'Answer briefly.' });
  const lead = defineAgent({ id: 'lead', struggle: false, model: { provider: 'fictional-faux', modelId: 'parent' }, instructions: 'Use tools.', tools: [postTool, readTool], delegates: [{ agent: researcher }] });
  const hooks = seam === 'afterTools-hook-continue'
    ? [hook(GenerationTask, { afterTools: async () => { stamp(`afterTools hook ran, ended=${state.ended}`); if (state.ended) { await state.conversation.configure({ maxTurns: 1 }, context); stamp('afterTools hook: configure returned'); } } })]
    : [];
  const hostExtension = defineExtension({ name: 'probe.host', hooks, wraps: [{ tool: 'post', wrap: gatedWrap }, { tool: 'read', wrap: plainWrap }, { tool: 'delegate', wrap: plainWrap }] });
  const registry = createRegistry();
  lead.install(registry);
  registry.install(hostExtension);
  const models = scriptedModels(shape, log);
  const settings = seam.endsWith('-continue') ? { afterFailedRun: 'continue' } : { afterFailedRun: 'keep' };
  const harness = await Harness.open(new MemoryStorage(), { registry, models, settings }, context);
  try {
    const conversation = await lead.createConversation(harness, context);
    state.conversation = conversation;
    await conversation.configure({ extensions: { add: [hostExtension] } }, context);
    const original = await conversation.submit({ type: 'input', requestId: 'ask', content: 'Please post the notes.' }, context);
    const settled = await Promise.race([original.wait(context), sleep(15000).then(() => undefined)]);
    const originalRecord = settled ?? await original.status(context);
    await sleep(200);
    let followRecord;
    if (state.followUp) followRecord = await Promise.race([state.followUp.wait(context), sleep(3000).then(() => undefined)]) ?? await state.followUp.status(context);
    const after = log.requests.filter(r => r.expired);
    const entries = await harness.commit(async tx => (await tx.scanEntries({ conversationId: conversation.id }, 100)).items, context);
    const kindOf = id => { const e = entries.find(x => x.id === id); if (!e) return undefined; const m = (e.data?.model ?? e.model ?? [])[0]; return { kind: e.kind, toolCalls: m?.content?.filter?.(p => p.type === 'toolCall').length, text: m?.content ? textOf(m).slice(0, 30) : undefined }; };
    const messages = (await conversation.context(context)).messages;
    const live = await harness.snapshot(LiveDoc, conversation.id, context);
    const originalAnswer = kindOf(originalRecord.answer);
    const lastOfRun = originalRecord.status !== 'done' ? 0 : originalAnswer?.toolCalls > 0 ? 0 : Number(/^R(\d+)/.exec(originalAnswer?.text ?? '')?.[1] ?? 0);
    const extraRequests = after.filter(r => r.n <= lastOfRun).length;
    const fate = !followRecord ? 'not submitted' : followRecord.status === 'done' ? 'kept (answered)' : followRecord.status === 'unanswered' ? `withdrawn (${followRecord.reason})` : `kept (still ${followRecord.status}, unanswered)`;
    return { seam, shape, extraRequests, followUpFate: fate, requestsTotal: log.requests.length, afterExpiry: after.map(r => ({ n: r.n, followUp: r.followUp })), original: { status: originalRecord.status, reason: originalRecord.reason, answer: originalRecord.answer, answerIs: kindOf(originalRecord.answer) }, followUp: followRecord && { status: followRecord.status, reason: followRecord.reason, answer: followRecord.answer, answerIs: kindOf(followRecord.answer) }, runFailure: live?.runFailure, tail: messages.slice(-3).map(m => `${m.role}:${textOf(m).slice(0, 40)}`), events: log.events.map(([t, e]) => `${t - log.events[0][0]}ms ${e}`) };
  } finally { await harness.close(context); }
}

const only = process.env.PROBE_ONLY?.split(',');
for (const seam of SEAMS) for (const shape of Object.keys(SHAPES)) {
  if (only && !only.includes(`${seam}:${shape}`)) continue;
  test(`${seam} / ${shape}`, async () => {
    const row = await runCase(seam, shape);
    console.log('ROW ' + JSON.stringify(row));
    assert.ok(row.requestsTotal >= 1);
  });
}
