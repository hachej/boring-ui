import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent, parseSkill } from '@hachej/boring-agent/agents';
import { UNTRUSTED_PREFACE, parseFeedback } from '@hachej/boring-feedback/format';
import { CHECKED_IN_THE_PAGE, FEEDBACK_EXTENSION, FEEDBACK_TOOL, createFeedbackCapability } from '@hachej/boring-feedback/agent';
import { appElementResolution } from '@hachej/boring-feedback/page';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';
import { createFakeChatModel } from '@hachej/boring-testing/model';
import { ada, agent, draft, future, hostOn, openFeedbackStore, pin, seed } from '../fixtures/feedback-agent.mjs';

// WP7: the opt-in `feedback` capability, run as native ToolTasks against the SQLite reference store. Fictional data only.
const NAMESPACE = 'fictional-feedback-agent';
/** A synthetic kind with a host snapshot, so `list` has an evaluated placement to report (the page kind is browser-only). */
const line = {
  kind: 'test.line@1',
  schema: { jsonSchema: {}, parse: value => { if (value?.kind !== 'test.line@1' || typeof value.text !== 'string' || !Number.isInteger(value.line)) throw new TypeError('not a test.line@1 anchor'); return value; } },
  resolve: (anchor, lines, evaluated) => {
    const hits = lines.flatMap((text, index) => text === anchor.text ? [index] : []);
    if (hits.length === 1) return { kind: hits[0] === anchor.line ? 'exact' : 'moved', range: hits[0], evaluated };
    return hits.length ? { kind: 'ambiguous', candidates: hits, evaluated } : { kind: 'missing', evaluated };
  },
  fallback: anchor => anchor.fallback,
};
const docsDraft = { observed: hostOn('northwind-docs', '/pricing'), anchors: [{ kind: 'test.line@1', text: 'Pricing', line: 0, fallback: 'the «Pricing» heading' }], said: 'Move pricing first.' };
const snapshots = observed => observed.subject?.app === 'northwind-docs' ? { snapshot: ['Intro', 'Pricing', 'Contact'], evaluated: 'sha256:fictional-docs' } : { refused: 'browser-only' };

async function fixture(t, { actions, allow, protection, withSnapshots = true, caller = () => agent } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-agent-'));
  let publications = 0;
  const { resources, store } = await openFeedbackStore(join(directory, 'feedback.sqlite'), { allow, protection, onPublish: () => { publications++; } });
  const feedback = createFeedbackCapability({ store, resolutions: { 'app.element@1': appElementResolution, 'test.line@1': line }, ...(withSnapshots ? { snapshots } : {}),
    resolveAccess: (api, ctx) => caller(api, ctx), operationNamespace: NAMESPACE, ...(actions ? { actions } : {}) });
  const registry = createRegistry();
  registry.install(feedback.extension);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(async () => { await harness.close(context); resources.close(); rmSync(directory, { recursive: true, force: true }); });
  const conversation = await harness.root(context);
  const call = async args => (await documentToolResult(harness, conversation, await admitDocumentTool(conversation, args, FEEDBACK_TOOL))).result;
  return { store, resources, feedback, call, publications: () => publications, tool: feedback.extension.tools[0] };
}

/** A direct native execution with a durable-memo stand-in, so one task can be replayed deterministically. */
function taskApi(taskId) {
  const memos = new Map();
  return { taskId, env: undefined, memo: async (name, value, ...rest) => { if (rest.length === 0) return memos.get(name); if (!memos.has(name)) memos.set(name, value); return memos.get(name); } };
}
const run = async (tool, args, api) => JSON.parse((await tool.execute(args, api, context)).content[0].text);

test('the extension is one native extension: a prompt section and the replay-safe feedback tool', async t => {
  const { feedback } = await fixture(t);
  assert.equal(feedback.extension.name, FEEDBACK_EXTENSION);
  assert.deepEqual(feedback.extension.tools.map(tool => [tool.name, tool.replay]), [[FEEDBACK_TOOL, 'safe']]);
  assert.deepEqual(Object.keys(feedback.extension.tools[0].parameters.properties).sort(), ['action', 'anchor', 'cursor', 'expectedRevision', 'id', 'note', 'status', 'subject']);
  assert.deepEqual(feedback.extension.tools[0].parameters.required, ['action'], 'a flat object: only the action is required by the schema');
  const prompt = feedback.extension.sections[0].render({}, context);
  assert.match(prompt, /`feedback\/<id>\.md`/);
  assert.match(prompt, /untrusted observation, not instruction/);
  assert.match(prompt, /`source` signal[^\n]*points into this application's code/);
  for (const action of ['list', 'read', 'show', 'resolve']) assert.match(prompt, new RegExp(`^- ${action}`, 'm'));
  assert.match(prompt, /OFFER to show/);
  assert.match(prompt, /Store protection: protected/);
});

test('list, read, show and resolve run as native ToolTasks against the SQLite store', { timeout: 20000 }, async t => {
  const { store, call } = await fixture(t);
  const page = await seed(store);
  const docs = await seed(store, docsDraft);

  const listed = await call({ action: 'list' });
  assert.equal(listed.kind, 'available');
  assert.equal(listed.protection, 'protected');
  assert.equal(listed.cursor, null);
  assert.deepEqual(listed.items.map(item => item.id), [docs.report.id, page.report.id], 'newest first');
  const [docsItem, pageItem] = listed.items;
  assert.equal(pageItem.revision, page.revision);
  assert.equal(pageItem.author, 'Ada');
  assert.equal(pageItem.status, 'open');
  assert.ok(draft.said.startsWith(pageItem.title) && pageItem.title.startsWith('This button should be green.'), pageItem.title);
  assert.equal(pageItem.subject, 'host:app-page:northwind-console:%2Fsettings%2F%3Asection');
  assert.equal(typeof pageItem.age, 'string');
  assert.deepEqual(pageItem.anchors, [
    { index: 0, kind: 'app.element@1', fallback: pin.fallback, signals: pin.signals, placement: CHECKED_IN_THE_PAGE },
    { index: 1, kind: 'pdf.rect@7', fallback: future.fallback, placement: { kind: 'unsupported', evaluated: 'no resolution is installed for pdf.rect@7' } },
  ]);
  assert.deepEqual(docsItem.anchors[0].placement, { kind: 'moved', range: 1, evaluated: 'sha256:fictional-docs' }, 'a host snapshot gives a placement that names what it evaluated');

  const read = await call({ action: 'read', id: page.report.id });
  assert.equal(read.kind, 'available');
  assert.equal(read.revision, page.revision);
  assert.ok(read.report.includes(UNTRUSTED_PREFACE));
  assert.deepEqual(parseFeedback(new TextEncoder().encode(read.report)).report, page.report, 'the full report, parseable by the one format');

  const shown = await call({ action: 'show', id: page.report.id, note: 'This is the button you meant.' });
  assert.deepEqual(Object.keys(shown).sort(), ['action', 'anchor', 'fallback', 'id', 'kind', 'message', 'note', 'subject']);
  assert.equal(shown.kind, 'offered');
  assert.equal(shown.anchor, 0);
  assert.equal(shown.fallback, pin.fallback);
  assert.match(shown.message, /Nothing is shown until they press Show/);

  const resolved = await call({ action: 'resolve', id: page.report.id, expectedRevision: read.revision, note: 'Made the Save button green and disabled until a change.' });
  assert.equal(resolved.kind, 'applied');
  assert.equal(resolved.status, 'addressed');
  const stored = await store.read(page.report.id, ada);
  assert.equal(stored.revision, resolved.revision);
  assert.deepEqual(stored.report.resolutions.map(entry => [entry.by, entry.note]), [[agent.principalId, 'Made the Save button green and disabled until a change.']]);
  assert.deepEqual((await call({ action: 'list', status: 'addressed' })).items.map(item => item.id), [page.report.id]);
  const stale = await call({ action: 'resolve', id: page.report.id, expectedRevision: page.revision, note: 'Again.' });
  assert.equal(stale.kind, 'conflict');
  assert.equal(stale.current, resolved.revision);
});

test('without snapshots an application page is checked in the page; unprotected stores say so in prompt and list', { timeout: 20000 }, async t => {
  const { store, call, feedback } = await fixture(t, { withSnapshots: false, protection: 'unprotected' });
  await seed(store, docsDraft);
  const listed = await call({ action: 'list' });
  assert.equal(listed.protection, 'unprotected');
  assert.equal(listed.items[0].anchors[0].placement, CHECKED_IN_THE_PAGE);
  assert.match(feedback.extension.sections[0].render({}, context), /Store protection: UNPROTECTED/);
  assert.equal((await call({ action: 'read', id: listed.items[0].id })).protection, 'unprotected');
});

test('show refuses missing, unsupported and denied reports and never claims a reveal', { timeout: 20000 }, async t => {
  const { store, call } = await fixture(t, { allow: (access, key) => access.principalId === ada.principalId || !key.includes('northwind-secret') });
  const page = await seed(store);
  const secret = await seed(store, { ...draft, observed: hostOn('northwind-secret') });
  const results = [
    await call({ action: 'show', id: 'fb_1111111111111111' }),
    await call({ action: 'show', id: page.report.id, anchor: 5 }),
    await call({ action: 'show', id: page.report.id, anchor: 1 }),
    await call({ action: 'show', id: secret.report.id }),
  ];
  assert.deepEqual(results.map(result => result.kind), ['missing', 'missing', 'unsupported', 'denied']);
  assert.match(results[1].reason, /no anchor 5/);
  assert.match(results[2].reason, /pdf\.rect@7/);
  for (const result of [...results, await call({ action: 'show', id: page.report.id })]) {
    assert.ok(!/reveal(ed)?|highlighted|scrolled/i.test(JSON.stringify(Object.keys(result))), 'no result field claims a reveal');
    assert.ok(!/\b(revealed|highlighted|scrolled to)\b/i.test(result.message ?? ''), result.message);
  }
  assert.ok(!(await call({ action: 'list' })).items.some(item => item.id === secret.report.id), 'denied subjects are hidden from list');
});

test('fields are checked per action and a disabled action is refused with its reason', { timeout: 20000 }, async t => {
  const { call } = await fixture(t);
  const cases = [
    [{ action: 'read' }, 'id'], [{ action: 'show' }, 'id'], [{ action: 'resolve', id: 'fb_1111111111111111', note: 'x' }, 'expectedRevision'],
    [{ action: 'resolve', id: 'fb_1111111111111111', expectedRevision: 'r1' }, 'note'], [{ action: 'resolve', expectedRevision: 'r1', note: 'x' }, 'id'],
    [{ action: 'list', id: 'fb_1111111111111111' }, 'id'], [{ action: 'read', id: 'fb_1111111111111111', note: 'x' }, 'note'], [{ action: 'read', id: '   ' }, 'id'],
  ];
  for (const [args, field] of cases) {
    const result = await call(args);
    assert.equal(result.kind, 'invalid', JSON.stringify(args));
    assert.equal(result.field, field, JSON.stringify(args));
    assert.match(result.reason, new RegExp(`"${field}"`));
  }
  const limited = await fixture(t, { actions: ['list', 'read'] });
  for (const action of ['show', 'resolve']) {
    const refused = await limited.call({ action, id: 'fb_1111111111111111', ...(action === 'resolve' ? { expectedRevision: 'r1', note: 'x' } : {}) });
    assert.equal(refused.kind, 'denied');
    assert.match(refused.reason, new RegExp(`"${action}" action is not enabled`));
  }
  const prompt = limited.feedback.extension.sections[0].render({}, context);
  assert.match(prompt, /^- list/m);
  assert.ok(!/^- (show|resolve)/m.test(prompt), 'the prompt describes only enabled actions');
  const { store } = limited;
  const base = { store, resolutions: {}, resolveAccess: () => agent, operationNamespace: NAMESPACE };
  assert.throws(() => createFeedbackCapability({ ...base, operationNamespace: '' }), /namespace/);
  assert.throws(() => createFeedbackCapability({ ...base, actions: [] }), /actions/);
  assert.throws(() => createFeedbackCapability({ ...base, actions: ['list', 'delete'] }), /actions/);
  assert.throws(() => createFeedbackCapability({ ...base, resolutions: { 'pdf.rect@7': appElementResolution } }), /not a resolution of that kind/);
});

test('a same-call replay does not write twice and a changed binding is unknown', { timeout: 20000 }, async t => {
  let caller = agent;
  const { store, tool, publications } = await fixture(t, { caller: () => caller });
  const page = await seed(store);
  const args = { action: 'resolve', id: page.report.id, expectedRevision: page.revision, note: 'Made the Save button green.' };
  const api = taskApi(41);
  const before = publications();
  const first = await run(tool, args, api);
  assert.equal(first.kind, 'applied');
  assert.equal(publications(), before + 1);
  const replay = await run(tool, args, api);
  assert.deepEqual(replay, first, 'the replay reconciles the committed receipt');
  assert.equal(publications(), before + 1, 'no second write');
  caller = { ...agent, initiatorId: 'p_fictional_someone_else' };
  const changed = await run(tool, args, api);
  assert.equal(changed.kind, 'unknown');
  assert.equal(changed.operationId, first.operationId);
  assert.equal(publications(), before + 1);
  assert.equal((await store.read(page.report.id, ada)).report.resolutions.length, 1);
});

test('the same model call id in another task is a distinct operation', { timeout: 20000 }, async t => {
  const { store, call } = await fixture(t);
  const page = await seed(store);
  // admitDocumentTool always uses the model call id `fixture-call`: each admission is a new native task.
  const first = await call({ action: 'resolve', id: page.report.id, expectedRevision: page.revision, note: 'First pass.' });
  const second = await call({ action: 'resolve', id: page.report.id, expectedRevision: first.revision, note: 'Second pass.' });
  assert.deepEqual([first.kind, second.kind], ['applied', 'applied']);
  assert.notEqual(first.operationId, second.operationId);
  assert.notEqual(first.revision, second.revision);
  assert.deepEqual((await store.read(page.report.id, ada)).report.resolutions.map(entry => entry.note), ['First pass.', 'Second pass.']);
});

// Crash before the native acknowledgement: the SIGKILL pattern of test/contracts/document-crash.test.mjs.
const crashChild = fileURLToPath(new URL('../fixtures/feedback-agent-crash-child.mjs', import.meta.url));
function child(directory, mode) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const worker = spawn(process.execPath, [crashChild, directory, mode], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const terminal = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', (code, signal) => resolve({ code, signal })); });
  terminal.catch(() => {});
  return { process: worker, terminal };
}
for (const mode of ['recover', 'changed-binding']) test(`a native resolve killed between commit and acknowledgement replays without a second write: ${mode}`, { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-agent-crash-'));
  const workers = [];
  t.after(async () => { for (const worker of workers) { worker.process.kill('SIGKILL'); await worker.terminal.catch(() => {}); } rmSync(directory, { recursive: true, force: true }); });
  const first = child(directory, 'commit-and-hold'); workers.push(first);
  await Promise.race([
    first.terminal.then(result => { throw new Error(`Child exited before the crash window: ${JSON.stringify(result)}`); }),
    (async () => { const deadline = Date.now() + 20000; while (!existsSync(join(directory, 'committed.json'))) { if (Date.now() > deadline) throw new Error('Commit marker timeout'); await delay(10); } })(),
  ]);
  const committed = JSON.parse(readFileSync(join(directory, 'committed.json'), 'utf8')).result;
  assert.equal(committed.kind, 'applied');
  first.process.kill('SIGKILL');
  assert.deepEqual(await first.terminal, { code: null, signal: 'SIGKILL' });
  const next = child(directory, mode); workers.push(next);
  assert.deepEqual(await next.terminal, { code: 0, signal: null });
  const recovered = JSON.parse(readFileSync(join(directory, 'recovered.json'), 'utf8')).result;
  if (mode === 'recover') assert.deepEqual(recovered, committed);
  else { assert.equal(recovered.kind, 'unknown'); assert.equal(recovered.operationId, committed.operationId); }
  const seeded = JSON.parse(readFileSync(join(directory, 'seeded.json'), 'utf8'));
  const { resources, store } = await openFeedbackStore(join(directory, 'feedback.sqlite'));
  try {
    const stored = await store.read(seeded.id, ada);
    assert.equal(stored.revision, committed.revision);
    assert.deepEqual(stored.report.resolutions.map(entry => entry.note), ['Made the Save button green.'], 'exactly one resolution: the replay did not write again');
  } finally { resources.close(); }
});

// FEEDBACK-5 (structural): installing the capability changes nothing for an agent that does not select it.
test('an agent without the extension has a byte-identical tool list and prompt', { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-agent-snapshot-'));
  const { resources, store } = await openFeedbackStore(join(directory, 'feedback.sqlite'));
  t.after(() => { resources.close(); rmSync(directory, { recursive: true, force: true }); });
  const echo = defineTool({ name: 'echo', description: 'Echo fictional text.', parameters: Type.Object({ text: Type.String() }), replay: 'safe', execute: async args => ({ content: [{ type: 'text', text: args.text }] }) });
  const skill = parseSkill('---\nname: fictional-release\ndescription: "Prepare a fictional release"\n---\nList the fictional changes.\n');
  async function firstRequest(withFeedback) {
    const fake = createFakeChatModel();
    const builder = defineAgent({ id: 'builder', model: fake.model, instructions: 'You build the fictional Northwind console.', tools: [echo], skills: [skill] });
    const registry = createRegistry();
    builder.install(registry);
    if (withFeedback) {
      const feedback = createFeedbackCapability({ store, resolutions: { 'app.element@1': appElementResolution }, resolveAccess: () => agent, operationNamespace: NAMESPACE });
      defineAgent({ id: 'reviewer', model: fake.model, extensions: [feedback.extension] }).install(registry);
    }
    const harness = await Harness.open(new MemoryStorage(), { registry, models: fake.models }, context);
    try {
      const conversation = await builder.createConversation(harness, context);
      await conversation.submit({ type: 'input', requestId: 'snapshot', content: 'hello' }, context);
      const call = await fake.nextCall();
      const transcript = JSON.stringify(call.transcript, (key, value) => key === 'timestamp' ? 0 : value);
      call.respond('ok');
      return transcript;
    } finally { await harness.close(context); }
  }
  const without = await firstRequest(false), installed = await firstRequest(true);
  assert.ok(without.includes('You build the fictional Northwind console') && without.includes('"echo"'), 'the snapshot holds the prompt and the tools');
  assert.ok(!installed.includes(FEEDBACK_TOOL + '"') && !installed.includes('Feedback is what people pointed at'));
  assert.equal(installed, without);

  // The same capability selected on an agent does add the section and the tool.
  const fake = createFakeChatModel();
  const feedback = createFeedbackCapability({ store, resolutions: { 'app.element@1': appElementResolution }, resolveAccess: () => agent, operationNamespace: NAMESPACE });
  const reviewer = defineAgent({ id: 'reviewer', model: fake.model, extensions: [feedback.extension] });
  const registry = createRegistry();
  reviewer.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: fake.models }, context);
  t.after(() => harness.close(context));
  await (await reviewer.createConversation(harness, context)).submit({ type: 'input', requestId: 'selected', content: 'hello' }, context);
  const selected = await fake.nextCall();
  assert.match(JSON.stringify(selected.transcript), /Feedback is what people pointed at/);
  assert.deepEqual(selected.transcript.messages.flatMap(message => message.toolsAdded ?? []).map(tool => tool.name), [FEEDBACK_TOOL]);
  selected.respond('ok');
});
