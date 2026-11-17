// A host process for the session's crash test (agent-host-session.test.mjs): `node host-session-child.mjs <sqlite file> submit|alarm`.
// Its one tool never finishes, so the parent kills the process while the turn is running. Prints `waiting` when the tool starts.
import { Harness, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createSession } from '@hachej/boring-agent/host-runtime';
import notes from '../../fixtures/host-apps/notes/app.ts';

const [file, mode] = process.argv.slice(2);
const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'main' }] });
faux.setResponses(Array.from({ length: 60 }, () => async (transcript) => {
  const last = transcript.messages.findLastIndex((m) => m.role === 'user');
  const after = transcript.messages.slice(last + 1).some((m) => m.role === 'toolResult');
  return after ? fauxAssistantMessage([fauxText('ack')]) : fauxAssistantMessage([fauxToolCall('stuck', {})], { stopReason: 'toolUse' });
}));
const models = createModels();
models.setProvider(faux.provider);
const stuck = defineTool({
  name: 'stuck', description: 'Never finishes.', parameters: { type: 'object', properties: {} }, replay: 'safe',
  execute: async () => { console.log('waiting'); await new Promise(() => undefined); },
});
const session = createSession({
  id: 'me:camille', def: notes, api: notes.api, storage: await openNodeSqliteStorage(file), services: () => { throw new Error('no app here'); },
  models, model: { provider: 'fictional-faux', modelId: 'main' }, budget: { reserveRun: async (i) => ({ reservationId: i.runId }), recordUsage: async () => ({ billedMicros: 0 }), settleRun: async () => undefined, releaseRun: async () => undefined },
  tools: ({ agent }) => defineExtension({ name: `host.tools.${agent}`, tools: agent === 'assistant' ? [stuck] : [] }),
  skills: () => ({ list: async () => [], version: async () => '1' }),
  kv: { get: async () => undefined, put: async () => undefined }, wake: { arm: async () => undefined }, language: async () => 'fr',
  openHarness: (storage, options, context) => Harness.open(storage, options, context),
});
if (mode === 'submit') {
  const response = await session.fetch(new Request('http://host.test/session?op=submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'crash-1', content: 'bloque' }) }), { id: 'camille', language: 'fr' });
  console.log('submitted', response.status);
  setInterval(() => undefined, 1_000);
} else {
  await session.alarm();
  console.log('alarm-returned');
  process.exit(0);
}
