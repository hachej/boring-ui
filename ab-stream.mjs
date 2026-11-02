// A/B of the streamed reply's path in node: the real harness (100 ms partial commits), the real chat transport handler, the real remote client and
// controller. A = native (exact operation batches), B = projected (a complete view per update, as the PM's member view). Same model stream:
// ~230 chars/s (4 chars / 17 ms), a transcript of N earlier turns. Prints the frame rhythm and sizes, and the controller's text updates.
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler, routeSubmissions } from '@hachej/boring-agent/chat-transport';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const identity = { runtimeId: 'r', scopeId: 's', principalId: 'p' };
const TURNS = Number(process.env.TURNS ?? 40), CHARS = 1400;
const reply = Array.from({ length: CHARS / 7 }, (_, i) => `mot${i % 10} `).join('');

async function run(mode) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const routed = routeSubmissions(conversation, async draft => { await conversation.submit(draft, context); });
  for (let i = 0; i < TURNS; i++) { // earlier turns, answered at once
    const sub = await conversation.submit({ type: 'input', requestId: `h${i}`, content: `Question ${i} `.repeat(6) }, context);
    (await fake.nextCall()).respond(`Réponse ${i} `.repeat(30));
    await sub.wait(context);
  }
  const handle = createChatTransportHandler({ authenticate: async () => ({ conversation: routed, context, ...(mode === 'projected' ? { project: view => JSON.parse(JSON.stringify(view)) } : {}) }) });
  const frames = [];
  const fetch = async request => {
    const res = await handle(request);
    if (new URL(request.url).searchParams.get('op') !== 'watch' || !res.body) return res;
    const [a, b] = res.body.tee();
    (async () => { const r = a.getReader(); const dec = new TextDecoder(); for (;;) { const { value, done } = await r.read(); if (done) break; const text = dec.decode(value); frames.push({ t: performance.now(), bytes: value.length, kind: /"kind":"ops"/.test(text) ? 'ops' : /"kind":"view"/.test(text) ? 'view' : 'other' }); } })();
    return new Response(b, { headers: res.headers });
  };
  const remote = await createRemoteChat({ endpoint: `https://x.invalid/chat?conversation=${conversation.id}`, fetch, pollMs: 20 });
  const controller = createNativeChatController({ identity, ...remote });
  await controller.connect();
  const seen = []; let applyMs = 0;
  controller.subscribe(() => {
    const live = controller.getSnapshot().view?.docs['pi.live'];
    const text = JSON.stringify(live?.generation ?? '');
    seen.push({ t: performance.now(), len: text.length });
  });
  controller.setText('Nouvelle question');
  frames.length = 0; seen.length = 0;
  const sending = controller.send();
  const call = await fake.nextCall();
  const t0 = performance.now();
  for (let i = 0; i < CHARS; i += 4) { call.append(reply.slice(i, i + 4)); await sleep(17); }
  call.respond('');
  await sending;
  await sleep(300);
  const q = (arr) => { const v = [...arr].sort((x, y) => x - y); return `min ${v[0]} p50 ${v[v.length >> 1]} p90 ${v[Math.floor(v.length * 0.9)]} max ${v.at(-1)}`; };
  const gaps = arr => arr.slice(1).map((e, i) => Math.round(e.t - arr[i].t));
  const grow = seen.filter((e, i) => i === 0 || e.len !== seen[i - 1].len);
  console.log(`[${mode}] turns ${TURNS} | frames ${frames.length} kinds ${[...new Set(frames.map(f => f.kind))]} | bytes/frame ${q(frames.map(f => f.bytes))} | total KB ${Math.round(frames.reduce((n, f) => n + f.bytes, 0) / 1024)}`);
  console.log(`[${mode}] frame gap ms ${q(gaps(frames))} | controller text updates ${grow.length} gap ms ${q(gaps(grow))} | first->last ${Math.round(grow.at(-1).t - grow[0].t)} ms`);
  await controller.dispose(); await remote.close(); await harness.close(context);
}
for (const mode of ['native', 'projected']) await run(mode);
process.exit(0);
