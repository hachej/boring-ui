// Probe host-probe-model-call-fence: can the host refuse one model call before it is sent, in the middle of a run, through a public seam.
// Scripted model only (pi-ai faux core), pi-durable 1.5.2 as installed, public exports only. Prints one JSON row per variant.
//
// Run: call 1 (parent) delegates; call S (researcher, same provider) answers; call 2 (parent) reads; call 3 (parent) is the one to refuse.
// The provider is a two-route scratch provider (the shape host-model-route will have): route 1 always throws a connection error before any
// token, the naive fallback then tries route 2, which is the faux model. The fence sits on each route, as a host's wrapper would.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, GenerationTask, LiveDoc, UsageDoc, MemoryStorage, createRegistry, defineExtension, defineTool, hook } from '@earendil-works/pi-durable';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const textOf = message => (typeof message.content === 'string' ? message.content : (message.content ?? []).filter(p => p.type === 'text').map(p => p.text).join(''));

const readTool = defineTool({ name: 'read', description: 'Read a fact.', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] }, replay: 'safe', execute: async () => ({ output: [{ type: 'text', text: 'fact' }] }) });

const VARIANTS = {
  control: 'nothing refuses: the scripted run completes (4 faux requests)',
  'throw-in-wrapper': 'the wrapper throws synchronously from the stream function for parent call >= 3',
  'error-stream-plain': 'the wrapper returns an error-event stream, message not retryable by pi',
  'error-stream-retryable': 'the wrapper returns an error-event stream, message pi treats as retryable ("overloaded")',
  'beforeProviderRequest-via-wire': 'pi-durable hook beforeProviderRequest throws for parent call >= 3; the routes call options.onPayload as pi-ai providers do',
  'beforeProviderRequest-bare-faux': 'same hook on the bare faux provider (which never calls onPayload)',
};

async function runVariant(variant) {
  const state = { outer: [], routes: [], faux: 0, hookCalls: [], sessions: [] };
  const faux = createFauxCore({ api: 'fictional-api', provider: 'fictional-kit', models: [{ id: 'm' }] });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('delegate', { task: 'Look something up.' }, { id: 'c-delegate' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('Child: nothing to report.')]),
    fauxAssistantMessage([fauxToolCall('read', { topic: 'x' }, { id: 'c-read' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxText('Parent: final answer.')]),
  ]);
  const countedFaux = (model, ctx, options) => { state.faux++; return faux.streamSimple(model, ctx, options); };
  const errorStream = (model, errorMessage) => {
    const events = createAssistantMessageEventStream();
    const message = { ...fauxAssistantMessage([]), api: model.api, provider: model.provider, model: model.id, stopReason: 'error', errorMessage };
    events.push({ type: 'error', reason: 'error', error: message }); events.end(message);
    return events;
  };
  const refusing = variant === 'throw-in-wrapper' || variant === 'error-stream-plain' || variant === 'error-stream-retryable';
  const refusal = variant === 'error-stream-retryable' ? 'Budget exhausted: the server is overloaded, try again' : 'Budget exhausted for this app';
  let parent;

  const route = (name, send) => (model, ctx, options, call) => {
    state.routes.push({ session: call.session, idx: call.idx, route: name });
    if (refusing && variant !== 'throw-in-wrapper' && call.refuse) return errorStream(model, refusal);
    const events = createAssistantMessageEventStream();
    (async () => {
      try {
        if (variant === 'beforeProviderRequest-via-wire') await options?.onPayload?.({ session: call.session, idx: call.idx, route: name }, model);
        const inner = send(model, ctx, options);
        for await (const event of inner) events.push(event);
        events.end(await inner.result());
      } catch (error) {
        const message = { ...fauxAssistantMessage([]), api: model.api, provider: model.provider, model: model.id, stopReason: 'error', errorMessage: error instanceof Error ? error.message : String(error) };
        events.push({ type: 'error', reason: 'error', error: message }); events.end(message);
      }
    })();
    return events;
  };
  const route1 = route('route1', () => { throw new Error('connection error: ECONNREFUSED'); });
  const route2 = route('route2', countedFaux);

  const fallback = (model, ctx, options) => {
    const session = options?.sessionId ?? 'none';
    parent ??= session;
    state.sessions.includes(session) || state.sessions.push(session);
    const idx = state.outer.filter(entry => entry.session === session).length + 1;
    state.outer.push({ session, idx });
    const call = { session, idx, refuse: session === parent && idx >= 3 };
    if (variant === 'throw-in-wrapper' && call.refuse) throw new Error(refusal);
    const events = createAssistantMessageEventStream();
    (async () => {
      let last;
      for (const attempt of [route1, route2]) {
        const buffered = [];
        let result;
        try { const stream = attempt(model, ctx, options, call); for await (const event of stream) buffered.push(event); result = await stream.result(); }
        catch (error) { throw error; }
        last = { buffered, result };
        if (result.stopReason !== 'error' || attempt === route2) break;
      }
      for (const event of last.buffered) events.push(event);
      events.end(last.result);
    })().catch(error => { events.push({ type: 'error', reason: 'error', error: { ...fauxAssistantMessage([]), api: model.api, provider: model.provider, model: model.id, stopReason: 'error', errorMessage: `fallback threw: ${error?.message}` } }); events.end({ ...fauxAssistantMessage([]), stopReason: 'error', errorMessage: `fallback threw: ${error?.message}` }); });
    return events;
  };
  const bare = variant === 'beforeProviderRequest-bare-faux';
  const provider = createProvider({
    id: 'fictional-kit', models: faux.models, auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } },
    api: bare ? { stream: countedFaux, streamSimple: countedFaux } : { stream: fallback, streamSimple: fallback },
  });
  const models = createModels();
  models.setProvider(provider);

  const researcher = defineAgent({ id: 'researcher', struggle: false, model: { provider: 'fictional-kit', modelId: 'm' }, instructions: 'Answer briefly.' });
  const lead = defineAgent({ id: 'lead', struggle: false, model: { provider: 'fictional-kit', modelId: 'm' }, instructions: 'Use tools.', tools: [readTool], delegates: [{ agent: researcher }] });
  const hooks = variant.startsWith('beforeProviderRequest')
    ? [hook(GenerationTask, { beforeProviderRequest: async request => { state.hookCalls.push(request.payload); if (request.payload?.session === parent && request.payload?.idx >= 3) { state.hookThrew = (state.hookThrew ?? 0) + 1; } if (request.payload?.session === parent && request.payload?.idx >= 3) throw new Error('Budget exhausted (hook)'); return undefined; } })]
    : [];
  const hostExtension = defineExtension({ name: 'probe.host', hooks });
  const registry = createRegistry();
  lead.install(registry);
  registry.install(hostExtension);
  // pi's default retry policy (maxRetries 3), only the backoff shortened from 2000 ms so the probe finishes.
  const settings = { retry: { enabled: true, maxRetries: 3, baseDelayMs: 20, maxAgentDelayMs: 1000 } };
  const harness = await Harness.open(new MemoryStorage(), { registry, models, settings }, context);
  try {
    const conversation = await lead.createConversation(harness, context);
    await conversation.configure({ extensions: { add: [hostExtension] } }, context);
    const original = await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research and read.' }, context);
    const settled = await Promise.race([original.wait(context), sleep(30000).then(() => undefined)]);
    const record = settled ?? await original.status(context);
    const live = await harness.snapshot(LiveDoc, conversation.id, context);
    const messages = (await conversation.context(context)).messages;
    const last = messages.at(-1);
    const usage = await harness.snapshot(UsageDoc, conversation.id, context);
    const parentCalls = state.outer.filter(e => e.session === parent);
    return {
      variant,
      fauxRequests: state.faux,
      parentOuterCalls: parentCalls.length,
      call3SeenByWrapper: parentCalls.filter(e => e.idx >= 3).length,
      routeEntriesForCall3: state.routes.filter(e => e.session === parent && e.idx >= 3).map(e => `${e.route}#${e.idx}`),
      callSThroughWrapper: state.routes.filter(e => e.session !== parent).map(e => `${e.route}#${e.idx}`),
      route2PassedWrapper: state.routes.some(e => e.route === 'route2'),
      hookInvocations: state.hookCalls.length, hookThrew: state.hookThrew ?? 0, hookPayloads: JSON.stringify(state.hookCalls).slice(0, 400),
      submission: { status: record.status, reason: record.reason, detail: record.detail },
      runFailure: live?.runFailure && { reason: live.runFailure.reason, detail: live.runFailure.detail },
      transcriptLast: last && { role: last.role, stopReason: last.stopReason, errorMessage: last.errorMessage, text: textOf(last).slice(0, 60) },
      usageModels: JSON.stringify(usage?.models ?? usage).slice(0, 200),
      sessions: state.sessions.length,
    };
  } finally { await harness.close(context); }
}

const only = process.env.PROBE_ONLY?.split(',');
for (const variant of Object.keys(VARIANTS)) {
  if (only && !only.includes(variant)) continue;
  test(variant, async () => {
    const row = await runVariant(variant);
    console.log('ROW ' + JSON.stringify(row));
    assert.ok(row.parentOuterCalls >= 0);
  });
}
