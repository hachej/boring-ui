import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { Window } from 'happy-dom';
import { createModels } from '@earendil-works/pi-ai/models';
import { createModelGateway, memoryBudget, scriptedUpstream } from '@hachej/boring-agent/model-gateway';
import { GATEWAY_PROVIDER, gatewayProvider } from '@hachej/boring-agent/gateway-provider';
import { anchorOf, createPrivacyPolicy, runPrivacyCanaries } from '@hachej/boring-feedback/page';
import { previewAnswerProblem } from '@hachej/boring-feedback/format';
import { PREVIEW_TOOLS, createPreviewAgent, createPreviewPage, createPreviewSession, parseDeclarations, pendingBrowserTasks } from '@hachej/boring-feedback/preview';
import { captureAnnotation, fetchSaveEndpoint } from '@hachej/boring-feedback/ui';
import { parseTicket } from '@hachej/boring-feedback/tickets';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { previewScriptedStep } from '../../examples/feedback/preview-script.mjs';
import { APP } from '../../examples/feedback/server.mjs';
import { api, authorized, openApp, openPage, policy as appPolicy, replyText } from '../fixtures/feedback-app.mjs';

const policy = createPrivacyPolicy();
const until = async (label, check) => { const deadline = Date.now() + 10000; while (!(await check())) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 20)); } };
const SESSION = 'fictional-preview-session';
const PAGE = `<div id="outside"><button data-testid="outside">Elsewhere</button></div>
<div id="app"><main data-feedback-visible="">
  <h1 data-testid="title">Fictional settings</h1>
  <form data-testid="form"><input data-testid="name" value="Fernhill Ceramics" />
    <button type="submit" data-testid="save" data-feedback-id="save" data-source="src/Settings.jsx:12" style="padding: 4px">Save profile</button>
    <span data-testid="hint">Saved <em>now</em></span>
  </form>
</main><aside data-testid="private"><p>Mara Quill paid</p></aside><div data-feedback-ignore=""><button data-testid="chrome">Chat</button></div></div>`;

/** A HappyDOM page with no script execution and no loading. */
function open(t) {
  const window = new Window({ url: 'https://fictional.invalid/settings/profile', settings: {
    enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true,
  } });
  window.document.body.innerHTML = PAGE;
  t.after(() => window.happyDOM.close());
  const document = window.document;
  const root = document.getElementById('app');
  const q = id => document.querySelector(`[data-testid="${id}"]`);
  return { window, document, root, q, saveAnchor: () => anchorOf(q('save'), policy, { root }).anchor };
}

test('declarations: allowlisted properties and functions only; no url(), expressions, variables, !important or markup', () => {
  assert.deepEqual(parseDeclarations('background-color: #2f9e44; color: rgb(255 255 255)').declarations, [['background-color', '#2f9e44'], ['color', 'rgb(255 255 255)']]);
  assert.ok(parseDeclarations('background: linear-gradient(red, calc(10% + 2px) blue)').ok);
  for (const css of ['background: url(https://fictional.invalid/x.png)', 'background-image: image-set("x.png" 1x)', 'width: expression(alert(1))', 'color: var(--x)',
    'color: attr(data-x)', 'color: red !important', 'color: red; } body { color: blue', '@import "x.css"', 'behavior: url(x.htc)', '-moz-binding: url(x)', 'content: "x"',
    'cursor: url(x), auto', 'src: x', 'href: /x', 'color: \\72 ed', 'color: red /* c */', 'color: javascript:alert(1)', 'font-family: "x"; background: u\\rl(x)', '', 'color']) {
    assert.equal(parseDeclarations(css).ok, false, css);
  }
});

test('page tools: pins and inspect ids inside the root only, every write logged and reverted exactly, only style and text touched', async t => {
  const { window, document, root, q, saveAnchor } = open(t);
  const before = root.outerHTML;
  const mutations = [];
  const observer = new window.MutationObserver(records => mutations.push(...records));
  observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
  const page = await createPreviewPage({ root, policy, anchors: [saveAnchor(), { kind: 'other.kind@1' }] });
  assert.deepEqual(page.pins.map(pin => [pin.id, pin.source, Boolean(pin.unplaced)]), [['p1', 'src/Settings.jsx:12', false], ['p2', undefined, true]]);
  const outline = page.inspect();
  assert.match(outline, /^p1 = e\d+: the «Save profile» button \(Settings\.jsx:12\)/);
  assert.doesNotMatch(outline, /Elsewhere|Chat|Mara|Fernhill Ceramics/, 'nothing outside the root, ignored, private or a form value');
  const idOf = testid => new RegExp(`(e\\d+) \\w+[^\\n]*data-testid=${testid}\\b`).exec(outline)?.[1];

  assert.ok(page.setStyle('p1', 'background-color: #2f9e44; color: #ffffff').ok);
  assert.equal(q('save').style.getPropertyValue('background-color'), '#2f9e44');
  assert.ok(page.setStyle('p1', 'background-color: #1b5e20').ok);
  assert.ok(page.setText('p1', 'Save studio profile').ok);
  assert.ok(page.hide(idOf('title')).ok);
  assert.ok(page.show(idOf('title')).ok);
  assert.equal(q('title').style.getPropertyValue('display'), '');
  // Refusals: unknown or outside elements, ignored subtrees, form values, private text, mixed content, forbidden CSS.
  for (const [outcome, reason] of [
    [page.setStyle('e999', 'color: red'), /no element/], [page.setStyle('#outside', 'color: red'), /no element/],
    [page.setStyle('p2', 'color: red'), /no element/], [page.setText(idOf('name') ?? 'p1x', 'x'), /cannot be changed|no element/],
    [page.setText(idOf('hint'), 'x'), /other elements/], [page.setStyle('p1', 'background: url(x.png)'), /not allowed/],
    [page.setText('p1', '<img src=x>'), /without markup/], [page.show('p1'), /was not hidden/],
  ]) { assert.equal(outcome.ok, false); assert.match(outcome.reason, reason); }
  const inspected = page.inspect();
  const privateId = /(e\d+) p\b/.exec(inspected.split('\n').filter(line => !line.includes('data-testid')).join('\n'))?.[1];
  if (privateId) assert.match(page.setText(privateId, 'x').reason, /private/);
  // An inspected element moved out of the root is refused.
  const titleId = idOf('title'), title = q('title'), next = title.nextSibling;
  mutations.push(...observer.takeRecords());
  document.getElementById('outside').append(title);
  assert.match(page.setStyle(titleId, 'color: red').reason, /no longer on the page/);
  next.parentNode.insertBefore(title, next);
  observer.takeRecords(); // this test's own move, not the tools'

  // Net changes: first from (the computed value; happy-dom computes none for these), last to; hide then show is a no-op and dropped.
  const save = { element: 'the «Save profile» button (Settings.jsx:12)', source: 'src/Settings.jsx:12' };
  assert.deepEqual(page.changes().map(({ from: _from, ...change }) => change), [
    { ...save, property: 'background-color', to: '#1b5e20' }, { ...save, property: 'color', to: '#ffffff' }, { ...save, text: true, to: 'Save studio profile' },
  ]);
  assert.equal(page.changes()[2].from, 'Save profile');
  assert.equal(previewAnswerProblem({ kind: 'approved', summary: 'ok', changes: page.changes() }), undefined);
  page.revert();
  page.revert();
  await new Promise(resolve => setTimeout(resolve, 0));
  observer.disconnect();
  assert.equal(root.outerHTML, before, 'revert restores the exact markup');
  const attributes = new Set(mutations.filter(record => record.type === 'attributes').map(record => record.attributeName));
  assert.deepEqual([...attributes], ['style'], 'no attribute other than style is ever written');
  assert.ok(mutations.filter(record => record.type === 'childList').every(record => record.target === q('save')), 'text changes touch the changed element only');
  assert.deepEqual(page.changes(), []);
});

/** The real gateway on a loopback socket with a scripted upstream; records every upstream request body. */
async function gateway(t, reply) {
  const bodies = [];
  const handler = createModelGateway({ basePath: '/api/llm', allow: { 'fernhill-preview': 'scripted' }, budget: memoryBudget({ requestsPerMinute: 100, maxTokensPerRequest: 512 }),
    authorize: request => request.headers.get('authorization') === `Bearer ${SESSION}` ? 'p_fictional_ada' : null,
    upstream: scriptedUpstream({ reply: (messages, request) => { bodies.push({ messages, tools: request.tools }); return reply(messages, request); } }) });
  const server = createServer(async (incoming, outgoing) => {
    const request = new Request(new URL(incoming.url, 'http://127.0.0.1'), { method: incoming.method, headers: incoming.headers, ...(incoming.method === 'POST' ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const chunk of response.body) outgoing.write(chunk);
    outgoing.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const models = createModels();
  models.setProvider(gatewayProvider({ baseUrl: `http://127.0.0.1:${server.address().port}/api/llm`, models: ['fernhill-preview'], getAuth: () => ({ authorization: `Bearer ${SESSION}` }) }));
  return { models, model: models.getModel(GATEWAY_PROVIDER, 'fernhill-preview'), bodies };
}

const toolMessages = messages => messages.filter(message => message.role === 'tool');

test('subagent loop: a fake model through the gateway calls the page tools; unknown tools are refused; approve and discard', async t => {
  const { root, q, saveAnchor } = open(t);
  const before = root.outerHTML;
  let submitted = 0;
  q('form').addEventListener('submit', () => { submitted++; });
  // Turn 1: unknown and forbidden tools plus inspect; turn 2: set_style on the pin; turn 3: a sentence.
  const reply = messages => {
    const tools = toolMessages(messages.slice(messages.findLastIndex(message => message.role === 'user')));
    if (tools.length === 0) return { toolCalls: [{ name: 'inspect', arguments: {} }] };
    if (tools.length === 1) return { toolCalls: [{ name: 'set_style', arguments: { element: 'p1', css: 'background-color: #2f9e44' } }] };
    return 'Made Save green.';
  };
  const { models, model, bodies } = await gateway(t, reply);
  const page = await createPreviewPage({ root, policy, anchors: [saveAnchor()] });
  const agent = createPreviewAgent({ models, model, page, instructions: 'make the save button green' });
  assert.deepEqual(await agent.say(), { text: 'Made Save green.' });
  assert.equal(q('save').style.getPropertyValue('background-color'), '#2f9e44');
  assert.deepEqual(bodies[0].tools, PREVIEW_TOOLS.map(tool => tool.name), 'only the page tools are declared');
  assert.match(JSON.stringify(bodies[0].messages), /Preview this change: make the save button green[\s\S]*p1: the «Save profile» button/);
  const approved = agent.approve();
  assert.equal(previewAnswerProblem(approved), undefined);
  assert.deepEqual(approved.changes.map(change => [change.property, change.to, change.source]), [['background-color', '#2f9e44', 'src/Settings.jsx:12']]);

  // A model asking for tools the page does not have gets error results, and nothing happens.
  const sneaky = await gateway(t, messages => toolMessages(messages).length ? 'done' : 'unused');
  const directModels = { complete: async (_model, context) => {
    const last = context.messages.at(-1);
    if (last.role === 'user') return { role: 'assistant', content: ['submit_form', 'fetch', 'navigate', 'eval', 'set_attribute', 'set_cookie'].map((name, index) => ({ type: 'toolCall', id: `x${index}`, name, arguments: { element: 'p1', url: 'https://fictional.invalid' } })),
      api: 'x', provider: 'x', model: 'x', usage: {}, stopReason: 'toolUse', timestamp: 0 };
    return { role: 'assistant', content: [{ type: 'text', text: 'ok' }], api: 'x', provider: 'x', model: 'x', usage: {}, stopReason: 'stop', timestamp: 0 };
  } };
  const second = createPreviewAgent({ models: directModels, model: sneaky.model, page, instructions: 'anything' });
  await second.say();
  const results = second.messages().filter(message => message.role === 'toolResult');
  assert.equal(results.length, 6);
  assert.ok(results.every(result => result.isError && /Refused: .*(not found|unknown)/i.test(result.content[0].text)), JSON.stringify(results.map(r => r.content[0].text)));
  assert.equal(submitted, 0, 'nothing was submitted');
  assert.deepEqual(agent.discard(), { kind: 'discarded' });
  assert.equal(root.outerHTML, before, 'discard reverts the page');
});

test('the scripted preview subagent sets the pinned element green, then darker', async t => {
  const { root, q, saveAnchor } = open(t);
  const { models, model } = await gateway(t, (messages, request) => previewScriptedStep(messages, request));
  const page = await createPreviewPage({ root, policy, anchors: [saveAnchor()] });
  const agent = createPreviewAgent({ models, model, page, instructions: 'make it green' });
  assert.match((await agent.say()).text, /Previewed on the «Save profile» button/);
  assert.equal(q('save').style.getPropertyValue('background-color'), '#2f9e44');
  assert.match((await agent.say('darker')).text, /Previewed/);
  assert.equal(q('save').style.getPropertyValue('background-color'), '#1b5e20');
  assert.deepEqual(agent.approve().changes.find(change => change.property === 'background-color').to, '#1b5e20');
});

test('session: the pending call is found in the view; approve answers the net changes and reverts; discard answers discarded', async t => {
  const { root, q, saveAnchor } = open(t);
  const before = root.outerHTML;
  const entry = (id, model) => ({ id, model });
  const call = { type: 'toolCall', id: 'call-7', name: 'browser_preview', arguments: { instructions: 'make it green', feedback: 'fb_2222222222222222' } };
  const view = { docs: { 'pi.live': { run: { taskId: 3 } } }, entries: [entry(4, [{ role: 'user', content: 'preview' }]), entry(5, [{ role: 'assistant', content: [call] }])] };
  const [task] = pendingBrowserTasks(view);
  assert.deepEqual(task, { id: '[5,"call-7"]', callId: 'call-7', arguments: call.arguments });
  assert.deepEqual(pendingBrowserTasks({ ...view, entries: [...view.entries, entry(6, [{ role: 'toolResult', toolCallId: 'call-7' }])] }), []);
  assert.deepEqual(pendingBrowserTasks({ ...view, docs: {} }), [], 'nothing pending when no run is going');

  const { models, model } = await gateway(t, (messages, request) => previewScriptedStep(messages, request));
  const answers = [];
  const make = () => createPreviewSession({ task, root: () => root, policy, models, model, anchors: async id => { assert.equal(id, 'fb_2222222222222222'); return [saveAnchor()]; },
    answer: async (id, text) => { answers.push([id, JSON.parse(text)]); return { kind: 'answered' }; } });
  const approving = make();
  await approving.start();
  assert.equal(approving.getSnapshot().status, 'ready');
  assert.equal(q('save').style.getPropertyValue('background-color'), '#2f9e44');
  await approving.approve();
  assert.equal(approving.getSnapshot().status, 'approved');
  assert.equal(answers[0][0], task.id);
  assert.equal(answers[0][1].kind, 'approved');
  assert.equal(previewAnswerProblem(answers[0][1]), undefined);
  assert.equal(root.outerHTML, before, 'approved changes travel in the answer; the page is not left changed');
  const discarding = make();
  await discarding.start();
  await discarding.discard();
  assert.deepEqual(answers[1], [task.id, { kind: 'discarded' }]);
  assert.equal(root.outerHTML, before);
});

test('privacy: canaries in the application root never reach the model or the answer sent to the server', async t => {
  const { document, root, saveAnchor } = open(t);
  const reply = messages => {
    const tools = toolMessages(messages);
    if (tools.length === 0) return { toolCalls: [{ name: 'inspect', arguments: {} }] };
    if (tools.length === 1) {
      const ids = [...new Set((tools[0].content ?? '').match(/\be\d+\b/g) ?? [])];
      return { toolCalls: ids.flatMap(element => [{ name: 'set_style', arguments: { element, css: 'background: #2f9e44; color: #ffffff' } }, { name: 'set_text', arguments: { element, text: 'Fictional' } }]) };
    }
    return 'Done.';
  };
  const { models, model, bodies } = await gateway(t, reply);
  // Planted where application data lives: inside the root, outside the visible region (text there may leave by policy).
  const result = await runPrivacyCanaries({ page: { document, root }, run: async (_context, emit) => {
    const page = await createPreviewPage({ root, policy, anchors: [saveAnchor()] });
    const agent = createPreviewAgent({ models, model, page, instructions: 'make everything green' });
    const said = await agent.say();
    emit('said', said);
    emit('model', bodies);
    emit('agent', agent.messages());
    const answer = agent.approve();
    assert.ok(answer.changes.length > 3, 'the canary elements were changed');
    emit('answer', answer);
    page.revert();
  } });
  assert.ok(result.scanned > 50);
  assert.deepEqual(result.hits, [], JSON.stringify(result.hits));
});

// ---------------------------------------------------------------- the composed example, headless

const APP_PAGE = `<div id="fernhill-app"><main data-feedback-visible=""><h1>Workspace settings</h1>
  <form><button type="submit" data-feedback-id="save-profile" data-testid="save-profile" data-source="examples/feedback/settings/SettingsPage.jsx:88">Save profile</button></form>
  <aside><p>Mara Quill paid invoice F-2210</p></aside></main></div>`;

test('example: "preview" → browser_preview waits; the page subagent (scripted, via /api/llm) previews; Approve → ticket with the approved change; Discard → nothing filed', async t => {
  const app = await openApp(t, { modelGateway: { log: () => {} } });
  const page = openPage(t, APP_PAGE);
  const save = page.document.querySelector('[data-testid=save-profile]');
  const capture = await captureAnnotation({ app: APP, build: 'dev-preview', policy: appPolicy, root: page.root }, [save]);
  const saved = await fetchSaveEndpoint(new URL('/api/feedback', app.url), authorized(app, 'ada'))({ operationId: 'op-preview-1',
    draft: { observed: capture.observed, anchors: capture.anchors, said: '', notes: [{ text: 'make it green', anchor: 0 }] } });
  assert.equal(saved.kind, 'saved');
  await app.say('ada', `@feedback/${saved.id}.md Please fix this.`);
  const { body: { conversationId } } = await api(app, 'ada', '/api/conversation');
  const remote = await createRemoteChat({ endpoint: new URL(`/api/chat?conversation=${conversationId}`, app.url), fetch: authorized(app, 'ada'), pollMs: 10 });
  const view = async () => (await remote.conversation.watch(remote.context)).value;
  const models = createModels();
  models.setProvider(gatewayProvider({ baseUrl: `${app.url}api/llm`, models: ['fernhill-preview'], getAuth: () => ({ authorization: `Bearer ${app.people.ada.token}` }) }));
  const before = page.root.outerHTML;

  const preview = async (decide) => {
    await remote.conversation.submit({ type: 'input', requestId: `preview-${decide}`, content: 'preview' }, remote.context);
    let task;
    await until('the pending browser_preview call', async () => (task = pendingBrowserTasks(await view())[0]));
    assert.deepEqual(task.arguments, { instructions: 'make it green', feedback: saved.id });
    const session = createPreviewSession({ task, root: () => page.root, policy: appPolicy, models, model: models.getModel(GATEWAY_PROVIDER, 'fernhill-preview'),
      anchors: async id => (await api(app, 'ada', `/api/feedback/${id}`)).body.report.anchors, answer: remote.answer });
    await session.start();
    assert.equal(session.getSnapshot().status, 'ready', session.getSnapshot().error);
    assert.equal(save.style.getPropertyValue('background-color'), '#2f9e44', 'Save is green on the page');
    await (decide === 'approve' ? session.approve() : session.discard());
    assert.equal(session.getSnapshot().status, decide === 'approve' ? 'approved' : 'discarded', session.getSnapshot().error);
    assert.equal(page.root.outerHTML, before, 'the page is back as it was');
    await remote.conversation.commit(tx => tx.submissionByRequest(conversationId, `preview-${decide}`), remote.context);
    await until('the builder finished', async () => (await view()).docs['pi.live']?.run === undefined && replyText(await app.messages('ada')).length > 0);
    return app.messages('ada');
  };

  const approved = await preview('approve');
  const tools = approved.filter(message => message.role === 'toolResult').slice(-5).map(message => message.toolName);
  assert.deepEqual(tools, ['browser_preview', 'load_skill', 'feedback', 'write', 'present']);
  const link = new RegExp(`Ticket for ${saved.id} filed \\(file\\): (${app.url}tickets/([A-Za-z0-9_-]+)) Please review it\\.`).exec(replyText(approved.slice(-1)));
  assert.ok(link, replyText(approved.slice(-1)));
  const stored = await app.files.read({ target: { resource: { providerId: app.files.providerId, path: `tickets/${link[2]}.md` }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, app.people.ada.access);
  const ticket = parseTicket(link[2], new TextDecoder().decode(stored.snapshot.bytes));
  assert.match(ticket.ticket.body, /### Approved preview/);
  assert.match(ticket.ticket.body, /- \[ \] AC-2: on `\/settings\/:section`, the «Save profile» button \(`examples\/feedback\/settings\/SettingsPage\.jsx:88`\): background-color is `#2f9e44` \(was `[^`]*`\), as previewed and approved/);

  const discarded = await preview('discard');
  assert.equal(replyText(discarded.slice(-1)), 'Preview discarded: the page is back as it was, and nothing was filed.');
  assert.equal(discarded.filter(message => message.role === 'toolResult' && message.toolName === 'write').length, 1, 'no second ticket');
});

test('the preview subpath bundles for the browser with Pi model code only: no node, durable runtime, agent package or key', async () => {
  const { build } = await import('esbuild');
  const result = await build({ stdin: { contents: "export * from '@hachej/boring-feedback/preview';", resolveDir: new URL('../../', import.meta.url).pathname }, bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(input => input.includes('packages/feedback/dist/preview/')));
  assert.ok(!inputs.some(input => /pi-durable|packages\/agent\/|packages\/feedback\/dist\/(store|agent|tickets|transcription|source)\//.test(input)), inputs.filter(input => /pi-durable|packages\/agent\//.test(input)).join());
  assert.ok(!/from\s*["']node:/.test(result.outputFiles[0].text));
});
