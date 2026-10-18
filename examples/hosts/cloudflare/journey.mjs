// Real-browser journey against a running deployment (or `wrangler dev`) of this recipe. Needs CHROMIUM and the access token.
//   CF_URL=https://boring-ui-v4-recipe.<subdomain>.workers.dev CF_TOKEN_FILE=.cache/cloudflare-recipe-token CHROMIUM=... node examples/hosts/cloudflare/journey.mjs
//   CF_ONLY=<scenario ids or group names, comma separated>   run only some scenarios (default: every scenario this deployment can run)
// It runs the SAME scenario files as the studio journey (lab/studio/scenarios/*.mjs) through the same UI runner, for the scenarios the
// standard agent's Workers capabilities allow, plus what is specific to this host: 401 without the token, the token gate, recovery after the
// Durable Object is reset, and an atomic rollback inside the object. Screenshots go to CF_EVIDENCE.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { createToolkit } from '../../../lab/studio/journey-toolkit.mjs';
import { applicable, expectations, runScenario } from '../../../lab/studio/journey-scenarios.mjs';
import { unavailableReason } from '../../../lab/studio/scenario-availability.mjs';
import { loadScenarios } from '../../../lab/studio/scenarios/index.mjs';

const base = (process.env.CF_URL ?? '').replace(/\/$/, '');
if (!base) throw new Error('Set CF_URL to the deployment URL');
const token = readFileSync(process.env.CF_TOKEN_FILE ?? '.cache/cloudflare-recipe-token', 'utf8').trim();
const evidence = process.env.CF_EVIDENCE ?? '.cache/evidence/cloudflare';
mkdirSync(evidence, { recursive: true });
const debugRoutes = process.env.CF_DEBUG_ROUTES === '1';
const steps = [];
const step = async (name, run) => { const started = Date.now(); const detail = await run(); steps.push({ name, ms: Date.now() - started, ...(detail ? { detail } : {}) }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const authorize = request => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${token}`); return fetch(new Request(request, { headers })); };
const api = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

let browser;
try {
  await step('a request without the token is refused, a wrong token too', async () => {
    assert.equal((await fetch(`${base}/api/agent`)).status, 401);
    assert.equal((await fetch(`${base}/api/chat?conversation=1&op=watch`)).status, 401);
    assert.equal((await fetch(`${base}/api/resources`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/api/agent`, { headers: { authorization: 'Bearer not-the-token' } })).status, 401);
    assert.equal((await fetch(`${base}/`)).status, 200, 'the static page itself is public; it holds no data');
  });
  // The chat socket (the page's default transport): the token rides as the subprotocol `bearer.<token>`, since a browser WebSocket has no headers.
  const socketUrl = id => `${base.replace(/^http/, 'ws')}/api/chat?conversation=${id}`;
  const openSocket = (id, protocols) => new Promise(resolve => {
    const socket = new WebSocket(socketUrl(id), protocols), frames = [];
    socket.onmessage = event => frames.push(event.data === 'pong' ? { kind: 'pong' } : JSON.parse(event.data));
    socket.onopen = () => resolve({ socket, frames });
    socket.onerror = () => resolve({ socket: undefined, frames });
  });
  const frameOf = async (frames, kind, from = 0, ms = 10000) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline; await pause(100)) { const found = frames.slice(from).find(frame => frame.kind === kind); if (found) return found; }
    throw new Error(`no ${kind} frame within ${ms} ms`);
  };
  const instance = async () => (await (await api('/api/agent')).json()).instance;
  const firstConversation = async () => (await (await api('/api/conversations')).json()).conversations[0].id;
  await step('the chat socket refuses an upgrade without the token, and serves a snapshot, ping and calls with it', async () => {
    const id = await firstConversation();
    assert.equal((await openSocket(id, ['boring.chat'])).socket, undefined, 'no token: the upgrade is refused');
    assert.equal((await openSocket(id, ['boring.chat', 'bearer.not-the-token'])).socket, undefined, 'a wrong token too');
    const { socket, frames } = await openSocket(id, ['boring.chat', `bearer.${token}`]);
    assert.ok(socket, 'the socket opens with the token');
    assert.equal(socket.protocol, 'boring.chat', 'the host selects the chat subprotocol, never echoing the credential');
    assert.equal((await frameOf(frames, 'view')).view.conversation.id, id, 'a snapshot first');
    socket.send('ping'); await frameOf(frames, 'pong');
    socket.send(JSON.stringify({ kind: 'call', id: 'journey-entries', op: 'entries', params: { limit: '5' } }));
    assert.equal((await frameOf(frames, 'reply')).status, 200);
    socket.close();
  });
  // Hibernation: an idle object with only this socket open (pinged every 10 s, answered by the platform's auto-response without waking it)
  // leaves memory; the next request meets a new instance while the socket is still open, and the socket receives a fresh snapshot.
  // Takes about two minutes (workerd evicts an idle object after 70 to 140 s), so it runs only with CF_HIBERNATION=1.
  if (process.env.CF_HIBERNATION === '1') await step('an idle open chat socket lets the Durable Object hibernate; the wake sends a fresh snapshot', async () => {
    const id = await firstConversation();
    const { socket, frames } = await openSocket(id, ['boring.chat', `bearer.${token}`]);
    await frameOf(frames, 'view');
    const before = await instance();
    for (let waited = 0; waited < 150_000; waited += 10_000) { await pause(10_000); socket.send('ping'); }
    const views = frames.filter(frame => frame.kind === 'view').length;
    const after = await instance();
    assert.notEqual(after, before, 'the object left memory while the socket stayed open (hibernated)');
    assert.equal(socket.readyState, WebSocket.OPEN);
    socket.send(JSON.stringify({ kind: 'call', id: 'journey-wake', op: 'submission', params: { requestId: 'none' } }));
    assert.equal((await frameOf(frames, 'reply')).status, 200);
    assert.ok(frames.filter(frame => frame.kind === 'view').length > views || frames.slice(-3).some(frame => frame.kind === 'view'), 'the wake reopened the watch with a snapshot');
    socket.close();
    return { before, after };
  });

  const agent = await (await api('/api/agent')).json();
  const variant = { ...agent.variant };
  assert.equal(variant.id, 'cloudflare');

  browser = await launch(`${base}/`, { evidence });
  await step('the page asks for the token once, then opens the chat (token never in the URL)', async () => {
    await browser.until('token form', `!!${q('[data-testid=token-form]')}`);
    await browser.screenshot('01-token-gate.png');
    await browser.type(q('[data-testid=token-input]'), 'wrong-token');
    await browser.click(q('[data-testid=token-submit]'));
    await browser.until('the wrong token is rejected', `!!${q('[data-testid=token-error]')}`);
    await browser.type(q('[data-testid=token-input]'), token);
    await browser.click(q('[data-testid=token-submit]'));
    await browser.until('the chat is live', `${q('[data-boring=pi-chat]')}?.dataset.connection === 'connected' && !!${q('[data-testid=composer-input]')}`, 60000);
    assert.equal(await browser.evaluate('location.href'), `${base}/`);
    assert.equal(await browser.evaluate('location.search + location.hash'), '');
  });

  // Page faults, set per tab in sessionStorage 'journey.faults' and read by a fetch wrapper that the page's scripts run after:
  // `refuseDiscovery` refuses that many discovery requests with a 503; `delayWrong` holds a discovery sent with that token for 5 s.
  const setFaults = faults => browser.evaluate(`sessionStorage.setItem('journey.faults', ${JSON.stringify(JSON.stringify(faults))})`);
  const PAGE_FAULTS = `(() => {
    const Socket = window.WebSocket;
    window.__chatSockets = [];
    window.WebSocket = function (url, protocols) { const socket = new Socket(url, protocols); if (String(url).includes('/api/chat')) window.__chatSockets.push(socket); return socket; };
    window.WebSocket.prototype = Socket.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    const send = window.fetch.bind(window);
    const read = () => { try { return JSON.parse(sessionStorage.getItem('journey.faults') ?? '{}'); } catch { return {}; } };
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).searchParams.get('op') === 'watch') window.__httpWatches = (window.__httpWatches ?? 0) + 1;
      if (new URL(request.url).pathname !== '/api/resources') return send(request);
      const faults = read();
      if (faults.refuseDiscovery > 0) { sessionStorage.setItem('journey.faults', JSON.stringify({ ...faults, refuseDiscovery: faults.refuseDiscovery - 1 })); return new Response(null, { status: 503 }); }
      if (faults.delayWrong && request.headers.get('authorization') === 'Bearer ' + faults.delayWrong) await new Promise(done => setTimeout(done, 5000));
      return send(request);
    };
  })();`;
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_FAULTS });
  const liveChat = `${q('[data-boring=pi-chat]')}?.dataset.connection === 'connected' && !!${q('[data-testid=composer-input]')}`;

  await step('a failed discovery shows an alert, and Retry opens the workspace', async () => {
    await setFaults({ refuseDiscovery: 1 });
    await browser.reload();
    await browser.until('the alert with Retry', `!!${q('p[role="alert"] button')}`, 30000);
    assert.match(await browser.evaluate(`${q('p[role="alert"]')}.innerText`), /could not be reached/);
    await browser.click(q('p[role="alert"] button'));
    await browser.until('the chat is live again', liveChat, 60000);
    await setFaults({});
  });

  await step('the page chat runs over the WebSocket transport, not an open HTTP stream', async () => {
    await browser.until('an open chat socket', 'window.__chatSockets?.some(socket => socket.readyState === 1)', 30000);
    assert.equal(await browser.evaluate('window.__httpWatches ?? 0'), 0, 'no HTTP watch stream was opened');
  });

  await step('a late 401 for a token the person replaced does not sign out the new token', async () => {
    await setFaults({ delayWrong: 'wrong-token' });
    await browser.evaluate(`sessionStorage.removeItem('recipe.token')`);
    await browser.reload();
    await browser.until('token form', `!!${q('[data-testid=token-form]')}`);
    await browser.type(q('[data-testid=token-input]'), 'wrong-token');
    await browser.click(q('[data-testid=token-submit]'));
    // /api/agent answers 401 at once and the gate says so; the discovery sent with the same token is still held (5 s).
    await browser.until('the wrong token is rejected', `!!${q('[data-testid=token-error]')}`);
    await browser.type(q('[data-testid=token-input]'), token);
    await browser.click(q('[data-testid=token-submit]'));
    await browser.until('the chat is live with the new token', liveChat, 60000);
    await pause(6000); // the held discovery now answers 401 for the replaced token
    assert.equal(await browser.evaluate(`!!${q('[data-testid=token-form]')}`), false, 'the late 401 did not return to the gate');
    assert.equal(await browser.evaluate(liveChat), true, 'the chat is still live');
    assert.equal(await browser.evaluate(`sessionStorage.getItem('recipe.token')`), token);
    await setFaults({});
  });

  const t = createToolkit({ browser, pageUrl: `${base}/`, step, base, authorize, identity: agent.identity,
    // Reset the Durable Object (ctx.abort): the next request starts a new in-memory instance on the same SQLite state.
    restartHost: async () => {
      const before = (await (await api('/api/agent')).json()).instance;
      await api('/api/debug/restart', { method: 'POST' }).catch(() => undefined);
      let after;
      for (let attempt = 0; attempt < 40 && !after; attempt++) {
        await pause(500);
        const response = await api('/api/agent').catch(() => undefined);
        if (response?.ok) { const found = await response.json(); if (found.instance !== before) after = found; }
      }
      assert.ok(after, 'the object answers again as a new in-memory instance (the old one was reset)');
      const list = await (await api('/api/conversations')).json();
      assert.ok(list.conversations.some(item => item.title), 'the conversation survived with its title');
    } });
  t.variantId = () => variant.id;
  // A fresh browser opened on a shared link has no token: it takes it from the fragment, as the page allows.
  t.linkSuffix = `#token=${token}`;

  const only = process.env.CF_ONLY?.split(',').map(item => item.trim()).filter(Boolean);
  const scenarios = await loadScenarios();
  await step(`scenarios the deployment cannot run (${variant.capabilities.join(', ')}) are listed disabled, with the reason`, async () => {
    await t.fresh();
    for (const scenario of scenarios.filter(candidate => !applicable(candidate, variant))) {
      const row = `[data-testid=scenario][data-scenario=${scenario.id}]`;
      await browser.until(`${scenario.id} is listed`, `!!${q(row)}`, 20000);
      assert.equal(await browser.evaluate(`${q(row)}.disabled`), true, `${scenario.id} is disabled`);
      assert.equal(await browser.evaluate(`${q(row)}.querySelector('[data-testid=scenario-reason]')?.textContent`), unavailableReason(scenario, variant, [variant]));
    }
  });
  if (!debugRoutes) await step('the debug routes are off unless ENABLE_DEBUG_ROUTES is set', async () => {
    for (const route of ['restart', 'atomicity']) assert.equal((await api(`/api/debug/${route}`, { method: 'POST' })).status, 404);
  });
  for (const scenario of scenarios) {
    if (only && !only.includes(scenario.id) && !only.includes(slug(scenario.group))) continue;
    if (!applicable(scenario, variant)) { console.log(`skip ${scenario.id}: ${unavailableReason(scenario, variant, [variant])}`); continue; }
    // A restart step resets the Durable Object through /api/debug/restart, which a deployment without ENABLE_DEBUG_ROUTES refuses.
    if (!debugRoutes && scenario.steps?.some(item => item.action === 'restart')) { console.log(`skip ${scenario.id}: restarting the Durable Object needs CF_DEBUG_ROUTES=1 against a deployment with ENABLE_DEBUG_ROUTES=1`); continue; }
    await runScenario(t, scenario, variant, expectations);
  }

  if (debugRoutes) await step('atomicity inside the object: a publication that fails after writing its rows leaves nothing behind', async () => {
    const proof = await (await api('/api/debug/atomicity', { method: 'POST' })).json();
    assert.equal(proof.rolledBack, true);
    assert.ok(proof.staged.documents > 0 && proof.staged.versions > 0, 'rows were really written before the fault');
    return proof;
  });

  assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource|ERR_CONNECTION|net::|TypeError: Failed to fetch|network error/i.test(problem)), []);
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify({ base, steps }, null, 2));
  console.log(JSON.stringify({ steps: steps.length, evidence }, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) { await browser.screenshot('last.png').catch(() => {}); await browser.close(); }
  process.exit(process.exitCode ?? 0);
}
