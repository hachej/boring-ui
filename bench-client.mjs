// CPU cost of the client's data path per streamed frame, on a real captured projected view (full vs the model-only parts stripped), in node:
// decode + split + JSON.parse (remote client), controller.acceptView, and the kit's derive() of the rows. process.cpuUsage, not wall time.
import { readFileSync } from 'node:fs';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { derive } from '@hachej/boring-ui-kit/chat-view';

const raw = readFileSync(process.argv[2], 'utf8');
const strip = line => { const f = JSON.parse(line); f.view.entries = f.view.entries.map(e => e.kind === 'pi.system' ? { id: e.id, conversationId: e.conversationId, kind: e.kind } : e); delete f.view.docs['pi.agent']?.instructions; return JSON.stringify(f); };
const N = 150;
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

async function run(label, line) {
  const frames = Array.from({ length: N }, (_, i) => { const f = JSON.parse(line); f.view.entries = f.view.entries.map(e => ({ ...e })); // a distinct frame each time, as a stream is
    const live = f.view.docs['pi.live'] ?? (f.view.docs['pi.live'] = {}); live.tick = i; return JSON.stringify(f); });
  const body = new ReadableStream({ async start(c) { const enc = new TextEncoder(); c.enqueue(enc.encode(frames[0] + '\n')); await new Promise(r => setTimeout(r, 50)); for (const l of frames.slice(1)) c.enqueue(enc.encode(l + '\n')); c.close(); } });
  const fetch = async request => new URL(request.url).searchParams.get('op') === 'watch' ? new Response(body) : new Response('{}', { status: 404 });
  const t0 = cpu();
  const remote = await createRemoteChat({ endpoint: 'https://x.invalid/c', fetch, pauseWhenHidden: false });
  const controller = createNativeChatController({ identity: { runtimeId: 'r', scopeId: 's', principalId: 'p' }, ...remote });
  let updates = 0; controller.subscribe(() => { updates++; });
  await controller.connect();
  while (updates < N - 1) await new Promise(r => setTimeout(r, 20));
  const total = cpu() - t0;
  const view = controller.getSnapshot().view;
  const t1 = cpu(); for (let i = 0; i < 200; i++) derive(view, { mode: 'expert' }); const deriveMs = (cpu() - t1) / 200;
  console.log(`${label}: frame ${Math.round(line.length / 1024)} KB | client data path ${(total / updates).toFixed(2)} ms CPU per frame (${updates} frames) | derive() ${deriveMs.toFixed(2)} ms per view`);
  await controller.dispose(); await remote.close();
}
const full = raw.split('\n')[0];
for (let i = 0; i < 2; i++) { await run('full    ', full); await run('stripped', strip(full)); }
process.exit(0);
