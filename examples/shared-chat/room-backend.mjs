// A fictional room host for the SharedChat room source. It speaks the door of boring-factory `services/channel/room.mjs`
// (`POST _room/<op>` and the space socket) over the real room kit: `createRoom` on pi-durable's node SQLite storage, `roomView` as the
// only reader, `wakeFor` deciding who answers. Membership, the agents and their replies are scripted here; nothing runs a model, and
// no credential, network or external service is involved. Tests use fictional data only.
//
// `strict: true` is the door as R2 ships it: no `wake` frame, no `conversationId` on stream frames, no open wakes in `history`.
// Without it the door also carries those three (the plan's B2 and "Resume"), and a `retry` operation for a stalled wake (B6).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { ROOM, createRoom, roomView } from '@hachej/boring-agent/room';

export const roomMembers = [
  { person: 'person:ana', name: 'Ana', role: 'owner' },
  { person: 'person:ben', name: 'Ben', role: 'validator' },
  // A directory entry with no usable name: the thread must say « A teammate », never this id.
  { person: 'person:dev', name: 'user_7c1e92a4', role: 'member' },
  // The platform provisions an agent row named by its id, with the id's slug as its role.
  { person: 'agent:pm', name: 'agent:pm', role: 'pm' },
  { person: 'agent:worker', name: 'agent:worker', role: 'worker' },
  { person: 'agent:verifier', name: 'agent:verifier', role: 'verifier' },
];
const isAgent = id => id.startsWith('agent:');
const pause = ms => new Promise(done => setTimeout(done, ms));
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
const text = (value, max = 8000) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw failure(400, 'text', `text of 1 to ${max} characters`); return value; };

function webSocketFrame(string) {
  const payload = Buffer.from(string), n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
  return Buffer.concat([head, payload]);
}

/**
 * @param {{ strict?: boolean, latencyMs?: number, streamMs?: number, now?: () => number }} options
 * `latencyMs`: every door answer waits this long (shows the optimistic bubble before the host answers). `streamMs`: pause between the agent's frames.
 */
export async function createRoomBackend({ strict = false, latencyMs = 0, streamMs = 60 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-room-'));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'room.sqlite')), { registry: createRegistry(), models: createModels() }, context);
  const room = createRoom({ harness, context });
  const members = roomMembers.map(m => ({ ...m }));
  const audience = () => ({ people: members.filter(m => !isAgent(m.person)).map(m => m.person).sort(), agents: members.filter(m => isAgent(m.person)).map(m => m.person).sort() });
  const cards = {};
  const sockets = new Set();
  const log = [];
  const control = { blocked: false, cut: new Set() };
  const pending = new Map();   // callId -> the wake waiting for a person's answer
  const silent = new Map();    // wakeId -> true while the scripted agent keeps quiet until `retry`
  const timers = new Set();
  let closed = false;

  const view = m => ({ id: m.person, name: m.name, kind: isAgent(m.person) ? 'agent' : 'person', role: m.role });
  const find = person => members.find(m => m.person === person);

  const send = (ws, frame) => { try { ws.socket.write(webSocketFrame(JSON.stringify(frame))); } catch { /* the socket is gone */ } };
  const everyone = (make) => { for (const ws of [...sockets]) for (const frame of make(ws.person)) send(ws, frame); };
  const landed = result => {
    if (!result.entry || result.duplicate) return;
    const conversationId = result.conversation;
    everyone(person => roomView([result.entry], cards, { id: person }).items.map(item => ({ type: 'message', conversationId, item })));
    for (const wake of result.wakes ?? []) {
      if (!strict) everyone(() => [{ type: 'wake', wakeId: wake.id, agent: wake.agent, conversationId: wake.conversation }]);
      void agentRuns(wake, result.entry);
    }
    for (const decision of result.decisions ?? []) if (decision.kind === 'answer') void answered(decision.callId, result.entry);
  };
  const stream = (wake, frames) => everyone(() => frames.map(frame => strict ? frame : { ...frame, conversationId: wake.conversation }));

  async function after(ms) { await new Promise(done => { const t = setTimeout(() => { timers.delete(t); done(); }, ms); timers.add(t); }); return !closed; }

  async function reply(wake, answer) {
    stream(wake, [{ type: 'step', wakeId: wake.id, label: 'Lire vos fichiers', status: 'running' }]);
    if (!await after(streamMs * 2)) return;
    stream(wake, [{ type: 'step', wakeId: wake.id, label: 'Lire vos fichiers', status: 'done' }, { type: 'step', wakeId: wake.id, label: 'Préparer la version', status: 'running' }]);
    for (const piece of answer.match(/.{1,24}(\s|$)/g) ?? [answer]) {
      if (!await after(streamMs)) return;
      stream(wake, [{ type: 'delta', wakeId: wake.id, text: piece }]);
    }
    if (!await after(streamMs)) return;
    const written = await room.settle(wake.agent, wake.id, { text: answer, steps: [{ label: 'Lire vos fichiers', status: 'done' }, { label: 'Préparer la version', status: 'done' }] });
    landed({ ...written, conversation: wake.conversation });
  }
  async function agentRuns(wake, cause) {
    if (wake.agent !== 'agent:pm') {
      if (!await after(streamMs * 2)) return;
      const written = await room.settle(wake.agent, wake.id, { text: 'Noté, je prépare l’essai.' });
      return landed({ ...written, conversation: wake.conversation });
    }
    const said = String(cause.data.text ?? '');
    if (/lent|slow/i.test(said)) { silent.set(wake.id, { wake, cause }); return; }
    if (/format/i.test(said)) {
      const question = await room.question(wake.agent, wake.id, { callId: `q:${wake.id}`, prompt: 'Quel format voulez-vous pour l’export ?', options: ['PDF', 'CSV'], allowFreeText: true });
      pending.set(`q:${wake.id}`, wake);
      return landed({ ...question, conversation: wake.conversation });
    }
    await reply(wake, 'Je regarde vos fichiers, puis je prépare une version que vous pourrez essayer.');
  }
  async function answered(callId, entry) {
    const wake = pending.get(callId);
    if (!wake) return;
    pending.delete(callId);
    await reply(wake, `Parfait, j’ajoute un export ${entry.data.text}.`);
  }

  // ---- the door ----
  const must = person => { const m = find(person); if (!m) throw failure(404, 'not-found', 'no such space'); return m; };
  const visible = (m, name) => name === 'main' || (name === 'admin' && isAgent(m.person));
  async function call(person, operation, input, key) {
    const member = must(person);
    if (operation === 'me') return { space: 'sp_fictionalroom', me: { ...view(member), engine: 'room' } };
    if (operation === 'conversations') return ['main'].map(id => ({ id, kind: id }));
    if (!['members', 'history', 'send', 'remove', 'pin', 'action', ...(strict ? [] : ['retry'])].includes(operation)) throw failure(404, 'operation', 'no such channel operation');
    const name = String(input.conversationId ?? '');
    if (!visible(member, name)) throw failure(404, 'not-found', 'no such conversation');
    if (operation === 'members') return members.map(view);
    if (operation === 'history') {
      const from = input.after === undefined ? undefined : Number(input.after);
      if (from !== undefined && !Number.isSafeInteger(from)) throw failure(400, 'cursor', 'an entry id');
      const folded = roomView(await room.entries(name, from), cards, { id: person });
      const wakes = strict ? {} : { wakes: (await room.wakes()).filter(w => w.conversation === name).map(w => ({ id: w.id, agent: w.agent, conversation: w.conversation })) };
      return { ...folded, ...wakes };
    }
    if (operation === 'retry') {
      const held = silent.get(String(input.wakeId));
      if (!held) throw failure(404, 'not-found', 'no such wake');
      silent.delete(held.wake.id);
      void reply(held.wake, 'Désolé pour l’attente : voici ce que j’ai trouvé dans vos fichiers.');
      return { ok: true };
    }
    if (typeof key !== 'string' || !key || key.length > 128) throw failure(400, 'key', 'an idempotency key');
    const requestId = `${operation === 'action' ? 'act' : 'web'}:${person}:${key}`;
    const data = { author: person };
    const draft = operation === 'send' ? { requestId, kind: 'room.message', data: { ...data, text: text(input.text), mentions: input.mentions ?? [], ...(input.replyTo !== undefined ? { replyTo: Number(input.replyTo) } : {}), attachments: [], steps: [] } }
      : operation === 'remove' ? { requestId, kind: 'room.removed', data: { ...data, target: await own(name, person, input.messageId) } }
        : operation === 'pin' ? { requestId, kind: 'room.pin', data: { ...data, title: text(input.title, 200), line: text(input.line, 1000), anchor: text(input.anchor, 500) } }
          : { requestId, kind: 'room.action', data: { ...data, requestId: text(input.requestId, 128), actionId: text(input.actionId, 64) } };
    const written = { ...(await room.write(name, draft, audience())), conversation: name };
    landed(written);
    return written;
  }
  async function own(name, person, id) {
    const target = (await room.entries(name)).find(e => e.id === Number(id) && e.kind === 'room.message');
    if (!target) throw failure(404, 'not-found', 'no such message');
    if (target.data.author !== person) throw failure(403, 'remove', 'only your own message');
    return target.id;
  }

  async function handle(request, response) {
    const url = new URL(request.url, 'http://room.invalid');
    if (!url.pathname.startsWith('/_room/')) return false;
    const operation = url.pathname.slice('/_room/'.length);
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = body ? JSON.parse(body) : {};
    const { idempotencyKey, ...rest } = input;
    const person = String(request.headers['x-room-person'] ?? '');
    log.push({ operation, person, body: input, at: Date.now() });
    if (latencyMs) await pause(latencyMs);
    try {
      if (control.blocked) throw failure(503, 'unavailable', 'The room is unreachable.');
      const result = await call(person, operation, rest, idempotencyKey);
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(error.status ?? 500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: error.code ?? 'error', message: error.message, retryable: (error.status ?? 500) >= 500 } }));
    }
    return true;
  }
  function upgrade(request, socket) {
    const url = new URL(request.url, 'http://room.invalid');
    const person = url.searchParams.get('person') ?? '';
    if (!url.pathname.endsWith('/live') || control.blocked || control.cut.has('*') || control.cut.has(person) || !find(person)) { socket.destroy(); return; }
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);
    const ws = { socket, person };
    sockets.add(ws);
    socket.on('data', chunk => { if ((chunk[0] & 0x0f) === 8) socket.end(Buffer.from([0x88, 0])); });
    socket.on('close', () => sockets.delete(ws));
    socket.on('error', () => sockets.delete(ws));
    everyone(() => [{ type: 'presence', members: [{ id: person, presence: 'here' }] }]);
  }

  // ---- seed: yesterday's room, written through the same door ----
  async function seed() {
    const write = async (name, draft) => landed({ ...(await room.write(name, draft, audience())), conversation: name });
    await write('main', { requestId: 'seed:1', kind: 'room.system', data: { author: ROOM.platform, line: 'Ben a rejoint' } });
    await write('main', { requestId: 'seed:2', kind: 'room.message', data: { author: 'person:ben', text: 'Le plan du jardin est prêt pour relecture.', mentions: [], attachments: [], steps: [] } });
    const card = await room.write('main', { requestId: 'card:csv:1', kind: 'room.card', data: { author: 'agent:worker', requestId: 'csv' } }, audience());
    cards.csv = { version: 1, title: 'Export CSV', state: 'preview', line: 'On attend votre essai', since: Date.now() - 600_000, actions: ['try', 'later'] };
    landed({ ...card, conversation: 'main' });
    await write('main', { requestId: 'seed:3', kind: 'room.pin', data: { author: 'person:ana', title: 'Le bouton est trop bas', line: 'Accueil, bouton Exporter', anchor: '#export' } });
  }
  await seed();

  return {
    handle, upgrade, log, members, sockets,
    /** Another person speaks through the same door (a second tab, an MCP agent, another device). */
    as: (person, operation, input = {}, key = `k${Math.random().toString(36).slice(2)}`) => call(person, operation, input, key),
    /** The host stops answering and refuses sockets, then answers again. */
    block: () => { control.blocked = true; },
    unblock: () => { control.blocked = false; },
    /** One person's sockets (all of them by default) close and are refused until `restore`, while the door keeps answering: what a phone loses in a tunnel. */
    cut: (person = '*') => { control.cut.add(person); for (const ws of [...sockets]) if (person === '*' || ws.person === person) { try { ws.socket.destroy(); } catch { /* gone */ } sockets.delete(ws); } },
    restore: (person = '*') => { if (person === '*') control.cut.clear(); else control.cut.delete(person); },
    /** Close every socket from the server side. */
    drop: () => { for (const ws of [...sockets]) { try { ws.socket.write(Buffer.from([0x88, 0])); ws.socket.destroy(); } catch { /* gone */ } } sockets.clear(); },
    entries: async (name = 'main') => room.entries(name),
    wakes: () => room.wakes(),
    close: async () => { closed = true; for (const t of timers) clearTimeout(t); for (const ws of sockets) ws.socket.destroy(); sockets.clear(); await harness.close(context); rmSync(directory, { recursive: true, force: true }); },
  };
}

/** A listening backend for tests: `url` serves the door and the socket on one origin. */
export async function startRoomBackend(options) {
  const backend = await createRoomBackend(options);
  const server = createServer(async (request, response) => { if (!await backend.handle(request, response)) response.writeHead(404).end(); });
  server.on('upgrade', backend.upgrade);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { ...backend, url: `http://127.0.0.1:${server.address().port}/`, close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await backend.close(); } };
}
