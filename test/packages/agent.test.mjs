import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { attachHarness } from '@hachej/boring-agent';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { admitDocumentTool, createSaveNoteTool, documentToolResult, toolResultText } from '../fixtures/native-document.mjs';

const target = { resource: { providerId: 'documents', path: 'notes.md' }, view: { kind: 'published' } };
const access = { principalId: 'editor', initiatorId: 'alice', scopeId: 'fictional-project' };

test('borrowed Harness executes a native publishing tool with actual publication and survives independent detaches', { timeout: 15000 }, async t => {
  let authorized = true;
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => authorized });
  const tool = createSaveNoteTool({ target, publisher: provider.publication, operationNamespace: 'fixture-runtime-v1', replay: 'safe', resolveAccess: api => { assert.equal(api.env, undefined); return access; } });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.document', tools: [tool] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(async () => { await harness.close(context); provider.close(); });
  const first = attachHarness({ harness }), second = attachHarness({ harness });
  assert.equal(first.harness, harness);
  const conversation = await harness.root(context);
  const independentWatch = await conversation.watch(context);
  t.after(() => independentWatch.stop());
  const taskId = await admitDocumentTool(conversation, { text: 'Fictional notes', expected: { kind: 'absent' } });
  const saved = await documentToolResult(first.harness, conversation, taskId);
  assert.equal(saved.result.kind, 'committed');
  assert.equal(saved.result.receipt.operationId, JSON.stringify(['fixture-runtime-v1', taskId]));
  const read = await provider.read({ target, revision: { kind: 'latest' } }, access);
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'Fictional notes');
  assert.deepEqual(await provider.reconciliation.lookup(saved.result.receipt.operationId, access), saved.result);
  await first.detach();
  await first.detach();
  const changed = Promise.withResolvers();
  independentWatch.start(() => changed.resolve());
  await conversation.configure({ instructions: 'Host still owns this conversation' }, context);
  await changed.promise;
  const staleId = await admitDocumentTool(conversation, { text: 'stale write', expected: { kind: 'revision', revision: 'stale' } });
  assert.equal((await documentToolResult(second.harness, conversation, staleId)).result.kind, 'conflict');
  authorized = false;
  const deniedId = await admitDocumentTool(conversation, { text: 'unauthorized', expected: { kind: 'revision', revision: read.snapshot.ref.revision } });
  assert.equal((await documentToolResult(harness, conversation, deniedId)).result.kind, 'denied');
  authorized = true;
  await second.detach();
  assert.equal(new TextDecoder().decode((await provider.read({ target, revision: { kind: 'latest' } }, access)).snapshot.bytes), 'Fictional notes');
  await conversation.configure({ instructions: 'Native API remains available after detach' }, context);
});

test('OptChat view: due-merging never splits, keeps the start stable and the budget; zoom reaches the whole message; stale fingerprints are rejected', async () => {
  const { OptChatLog, OptChatTree, advanceFold, emptyFold, leavesOf, renderView, zoomText } = await import('@hachej/boring-agent/memory/optchat');
  const NODE = 100, BUDGET = 1500;
  const messages = [];
  for (let i = 0; i < 120; i++) {
    messages.push({ role: 'user', content: `note ${i}: ${'word '.repeat(i % 30)}`, timestamp: i });
    messages.push({ role: 'assistant', content: [{ type: 'text', text: `ack ${i}` }], timestamp: i });
  }
  const { leaves } = leavesOf(messages);
  assert.equal(leaves.length, 240);
  // A summary for every node that is not its own text, as a compactor would have stored them.
  const build = (log, stored) => {
    const tree = new OptChatTree(log, stored, NODE);
    for (let level = 0; 2 ** level <= log.leaves.length; level++) for (let index = 0; (index + 1) * 2 ** level <= log.leaves.length; index++) {
      if (tree.text(level, index) === undefined) stored.set(`${level}:${index}`, { text: `summary ${level}:${index}`, of: log.fp(level, index) });
    }
    return tree;
  };
  const log = new OptChatLog(), stored = new Map(), tree = build((log.set(leaves), log), stored);
  const growing = new OptChatLog(), view = emptyFold(), growingTree = new OptChatTree(growing, stored, NODE);
  let previous, before;
  const shared = [];
  for (let t = 1; t <= leaves.length; t++) {
    growing.set(leaves.slice(0, t));
    advanceFold(view, growingTree, t, BUDGET);
    assert.ok(view.size <= BUDGET, `view ${view.size} B at ${t} leaves`);
    let at = 0;
    for (const part of view.parts) { assert.equal(part.index * 2 ** part.level, at, 'parts tile the log in order'); at += 2 ** part.level; }
    assert.equal(at, t);
    // Never split: every earlier part lies inside exactly one current part.
    for (const old of previous ?? []) assert.equal(view.parts.filter(part => part.index * 2 ** part.level <= old.start && old.start + old.n <= (part.index + 1) * 2 ** part.level).length, 1);
    previous = view.parts.map(part => ({ start: part.index * 2 ** part.level, n: 2 ** part.level }));
    const lines = renderView(view, growingTree).split('\n');
    if (t > 120 && before) { let same = 0; while (same < before.length && before[same] === lines[same]) same++; shared.push(same / before.length); }
    before = lines;
  }
  assert.ok(shared.reduce((sum, value) => sum + value, 0) / shared.length > 0.5, 'consecutive views share most of their start, so a provider prompt cache is reused');
  assert.equal(view.parts[0].index, 0);
  assert.ok(view.parts.length < 60 && view.parts[0].level > 2, 'old history is coarse');
  // Zoom from the first line down to a whole message: the exact leaf text.
  let line = renderView(view, growingTree).split('\n')[1], target = leaves[0].line;
  for (let depth = 0; depth < 12; depth++) {
    const [, id, n] = /^(\d+)\+(\d+)\|/.exec(line);
    if (n === '0') break;
    line = zoomText(tree, Number(id), Number(n)).split('\n')[0];
  }
  assert.equal(line, `0+0|${target}`);
  assert.equal(zoomText(tree, 3, 2), 'No line 3+2.');
  // A fork or an edit changes the content: summaries of different content are not shown.
  const edited = leaves.slice(); edited[5] = leavesOf([{ role: 'user', content: `note 5: ${'EDITED '.repeat(30)}`, timestamp: 5 }]).leaves[0];
  const editedLog = new OptChatLog(); editedLog.set(edited);
  const editedTree = new OptChatTree(editedLog, stored, NODE);
  assert.equal(tree.text(0, 5) !== undefined, true);
  assert.notEqual(editedTree.text(0, 5), tree.text(0, 5), 'the edited message never shows the old summary');
  assert.equal(editedTree.text(2, 1), undefined, 'a node over the edited message is unbuilt until rebuilt');
  assert.equal(editedTree.text(2, 2), tree.text(2, 2), 'nodes elsewhere stay valid');
});

test('OptChat memory is opt-in per conversation: the request carries the view and the current turn, the transcript is untouched, zoom reaches the exact message', { timeout: 20000 }, async t => {
  const { createOptChatMemory } = await import('@hachej/boring-agent/memory/optchat');
  const { createProvider } = await import('@earendil-works/pi-ai/models');
  const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai/utils/event-stream');
  const textOf = message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  const MODEL = { id: 'scripted', name: 'Scripted', provider: 'scripted', api: 'scripted-api', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const requests = [];
  // Answers only from what the request contains.
  const decide = messages => {
    const last = messages.at(-1), said = textOf(last);
    if (last.role === 'toolResult') return { text: `zoomed: ${said}` };
    if (/Use zoom/.test(said)) return { tool: { name: 'zoom', arguments: { id: 0, n: 1 } } };
    if (/what is my dog called/i.test(said)) return { text: `Your dog is ${/dog is called (\w+)/.exec(messages.map(textOf).join('\n'))?.[1] ?? 'unknown'}.` };
    return { text: 'Noted.' };
  };
  const stream = (_model, request) => {
    requests.push(structuredClone(request));
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    setTimeout(() => {
      const answer = decide(request.messages.filter(item => item.role !== 'system'));
      events.push({ type: 'start', partial: message });
      if (answer.tool) {
        const toolCall = { type: 'toolCall', id: `call-${requests.length}`, name: answer.tool.name, arguments: answer.tool.arguments };
        message.content.push(toolCall); message.stopReason = 'toolUse';
        events.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message }); events.push({ type: 'done', reason: 'toolUse', message });
      } else {
        message.content.push({ type: 'text', text: answer.text });
        events.push({ type: 'text_end', contentIndex: 0, content: answer.text, partial: message }); events.push({ type: 'done', reason: 'stop', message });
      }
      events.end(message);
    }, 5);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: MODEL.provider, models: [MODEL], auth: { apiKey: { name: 'keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  // A second, separate model is the summarizer: the first words of what it summarizes, marked, so the view is visibly not the original text. Each call reports usage.
  const SUMMARIZER = { ...MODEL, id: 'summ', name: 'Summ', provider: 'summ', api: 'summ-api' };
  let summarizerCalls = 0;
  const summarize = (_model, request) => {
    summarizerCalls++;
    const events = createAssistantMessageEventStream();
    const lines = textOf(request.messages.findLast(item => item.role === "user")).split(/(?:Compress this message into one line|Merge these two lines into one), in at most \d+ bytes:\n/)[1].split('\n');
    const line = `~ ${lines.map(item => item.split(' ').slice(0, 6).join(' ')).join(' / ')}`;
    const message = { role: 'assistant', content: [{ type: 'text', text: line }], api: SUMMARIZER.api, provider: SUMMARIZER.provider, model: SUMMARIZER.id, timestamp: Date.now(), stopReason: 'stop',
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } } };
    setTimeout(() => { events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: 'stop', message }); events.end(message); }, 20);
    return events;
  };
  models.setProvider(createProvider({ id: SUMMARIZER.provider, models: [SUMMARIZER], auth: { apiKey: { name: 'keyless', resolve: async () => ({ auth: {} }) } }, api: { stream: summarize, streamSimple: summarize } }));
  let harness;
  // The model may depend on the conversation (a host with one conversation per site picks each one's model).
  const askedFor = new Set();
  const summarizer = { model: async conversationId => { askedFor.add(String(conversationId)); return { provider: 'summ', modelId: 'summ' }; } };
  const memory = createOptChatMemory({ harness: () => harness, context, summarizer, nodeBytes: 160, viewBytes: 4000, retryMs: 20, settleTimeoutMs: 5000 });
  const plain = defineExtension({ name: 'fixture.plain', sections: [] });
  const registry = createRegistry();
  registry.install(plain); registry.install(memory.extension);
  harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(async () => { await memory.dispose(); await harness.close(context); });
  // Watch Pi's task graph: summaries must show up as native, background, conversation-owned tasks.
  const graph = await harness.taskGraph(context);
  const nodeTasks = new Map();
  const watchGraph = value => { for (const node of Object.values(value.tasks)) if (node.kind === 'boring.memory.optchat.node') nodeTasks.set(node.id, { background: node.background, owner: node.owner, status: node.state.status }); };
  graph.subscribe(watchGraph); watchGraph(graph.value);
  t.after(() => graph.dispose());
  const conversation = await harness.root(context, { agent: { model: { provider: 'scripted', modelId: 'scripted' }, extensions: [plain], instructions: 'Be brief.' } });
  harness.resume();
  const say = async text => { await (await conversation.submit({ type: 'input', content: text }, context)).wait(context); return requests.length; };
  const sent = from => requests.slice(from).map(request => request.messages);
  const system = messages => messages.filter(message => message.role === 'system');

  await say('My dog is called Biscuit.');
  await say(`Filler one. ${'The weather is fictional and the notes are long. '.repeat(8)}`);
  let seen = requests.length;
  assert.ok(sent(0).every(messages => !JSON.stringify(messages.filter(message => message.role !== 'system')).includes('<chat>')), 'not selected: the plain transcript');

  await conversation.configure({ extensions: { add: [memory.extension] } }, context);
  for (let i = 0; i < 3; i++) await say(`Filler ${i + 2}. ${'More fictional text to summarize here. '.repeat(8)}`);
  await say('Tell me what is my dog called?');
  const answered = sent(seen).at(-1);
  assert.match(textOf(answered.findLast(message => message.role === 'user')), /^<chat>\n/, 'the view comes first in the current user message');
  assert.equal(answered.filter(message => message.role === 'user').length, 1, 'no old user message is sent');
  assert.equal(answered.filter(message => message.role === 'assistant').length, 0, 'no old assistant message is sent');
  assert.ok(!textOf(answered.findLast(message => message.role === 'user')).includes('Filler 2. The weather'), 'long old messages appear only as summaries');
  const log = await conversation.context(context);
  assert.deepEqual(system(answered), system(log.messages), 'every positional system message is kept');
  assert.ok(system(answered).some(message => /zoom\(id, n\)/.test(JSON.stringify(message.sections ?? {}))), 'the view is explained in a system section');
  assert.ok(log.messages.filter(message => message.role !== 'system').every(message => !JSON.stringify(message).includes('<chat>')), 'the stored transcript is never rewritten');
  const reply = log.messages.findLast(message => message.role === 'assistant');
  assert.equal(textOf(reply), 'Your dog is Biscuit.', 'a fact from outside the current turn came back through the view');

  seen = requests.length;
  await say('Use zoom to reopen the first message.');
  const [toolStep, resultStep] = sent(seen);
  assert.equal(toolStep.filter(message => message.role === 'assistant').length, 0);
  assert.deepEqual(resultStep.map(message => message.role).filter(role => role !== 'system'), ['user', 'assistant', 'toolResult'], 'the turn in progress stays verbatim');
  assert.equal(textOf(resultStep.at(-1)), '0+0|user: My dog is called Biscuit.', 'zoom returns the exact message');
  assert.match(await memory.date(conversation.id, 0), /^\d{4}-\d\d-\d\dT/, 'date answers with the message time');
  assert.equal(await memory.date(conversation.id, 9999), 'No message 9999.');
  // Background summary work may still be running after the last answer (Pi runs it); wait for it to drain, then account.
  for (let i = 0; i < 200 && !(await memory.stats(conversation.id)).compactor.idle; i++) await new Promise(resolve => setTimeout(resolve, 25));
  const stats = await memory.stats(conversation.id);
  assert.ok(stats.summaries > 0 && stats.view.open === 0 && stats.view.bytes <= stats.view.budget, JSON.stringify(stats.compactor));
  assert.ok(nodeTasks.size > 0 && [...nodeTasks.values()].every(task => task.background === true && task.owner === undefined), 'summaries were native background tasks owned by the conversation');
  assert.equal(stats.compactor.calls, summarizerCalls, 'the state document counts every summarizer call');
  assert.deepEqual([...askedFor], [String(conversation.id)], 'the model callback is told which conversation it summarizes');
  const spend = stats.compactor.usage;
  assert.ok(spend.input === 10 * summarizerCalls && spend.output === 5 * summarizerCalls && Math.abs(spend.cost - 0.003 * summarizerCalls) < 1e-9, 'the summarizer spend is recorded by the extension');
  assert.equal((await harness.usage(context)).models['summ/summ'], undefined, 'and never written into Pi\'s own pi.usage (no public seam: BORING-PI-4)');
  assert.equal(stats.compactor.busy, 0);
  const compacting = await conversation.compact(undefined, context);
  assert.equal((await harness.waitForTask(compacting, context)).state.outcome.status, 'completed');
  assert.equal((await conversation.context(context)).head, undefined, 'native compaction declined while selected: no summary head in the transcript');

  await conversation.configure({ extensions: { remove: [memory.extension] } }, context);
  seen = requests.length;
  await say('And now plainly: hello.');
  const plainAgain = sent(seen).at(-1);
  assert.ok(!JSON.stringify(plainAgain.filter(message => message.role !== 'system')).includes('<chat>'));
  assert.ok(plainAgain.some(message => message.role === 'system' && message.sections?.['optchat-view'] === null), 'Pi retires the prompt section when the extension is deselected');
  assert.ok(plainAgain.some(message => message.role === 'user' && textOf(message) === 'My dog is called Biscuit.'), 'off: the whole transcript is sent again');
});

test('OptChat summary tasks are Pi\'s: pending ones survive a reopen and are finished by the reinstalled extension', { timeout: 30000 }, async t => {
  const { createOptChatMemory } = await import('@hachej/boring-agent/memory/optchat');
  const { openNodeSqliteStorage } = await import('@earendil-works/pi-durable/storage/sqlite/node');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'optchat-reopen-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const models = await answeringModels();
  const open = async summarize => {
    let harness;
    const memory = createOptChatMemory({ harness: () => harness, context, summarizer: { summarize }, nodeBytes: 120, viewBytes: 4000, settleTimeoutMs: 100 });
    const registry = createRegistry();
    registry.install(memory.extension);
    harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models }, context);
    return { harness, memory };
  };
  const live = async harness => (await harness.inspect(context)).tasks.filter(task => task.record.kind === 'boring.memory.optchat.node').map(task => task.record);

  // First process: the summarizer never answers, so the node tasks stay live.
  const first = await open((_job, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('closed')))));
  const conversation = await first.harness.root(context, { agent: { model: { provider: 'scripted', modelId: 'scripted' }, extensions: [first.memory.extension] } });
  first.harness.resume();
  for (let i = 0; i < 3; i++) await (await conversation.submit({ type: 'input', content: `Message ${i}. ${'Fictional filler text that is long enough to need a summary. '.repeat(6)}` }, context)).wait(context);
  const stuck = await live(first.harness);
  assert.ok(stuck.length > 0 && stuck.every(task => task.background), 'summary tasks are live, background tasks');
  assert.equal(new Set(stuck.map(task => task.input.key)).size, stuck.length, 'one live task per node key');
  await first.memory.dispose();
  await first.harness.close(context);

  // Second process: the extension brings the task definition back and Pi runs the pending work.
  const second = await open(async job => `~ ${job.source.map(line => line.split(' ').slice(0, 4).join(' ')).join(' / ')}`);
  t.after(async () => { await second.memory.dispose(); await second.harness.close(context); });
  second.harness.resume();
  const deadline = Date.now() + 15000;
  while ((await live(second.harness)).length > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await live(second.harness)).length, 0, 'no summary task is left');
  for (const task of stuck) assert.equal((await second.harness.getTask(task.id, context)).state.outcome.status, 'completed', 'a task created before the restart finished after it');
  const stats = await second.memory.stats(conversation.id);
  assert.ok(stats.summaries > 0 && stats.compactor.idle && stats.compactor.failed === 0, JSON.stringify(stats.compactor));
});

/** Models whose one provider always answers `Noted.`, so a conversation can run without a real model. */
async function answeringModels() {
  const { createProvider } = await import('@earendil-works/pi-ai/models');
  const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai/utils/event-stream');
  const MODEL = { id: 'scripted', name: 'Scripted', provider: 'scripted', api: 'scripted-api', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const stream = () => {
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    setTimeout(() => { events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: 'stop', message }); events.end(message); }, 5);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: MODEL.provider, models: [MODEL], auth: { apiKey: { name: 'keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return models;
}

test('OptChat: a failed summary is a failed native task; the next trigger after retryMs creates it again, the failure time lives in a document and no timer retries', { timeout: 20000 }, async t => {
  const { createOptChatMemory } = await import('@hachej/boring-agent/memory/optchat');
  const reported = [];
  let attempts = 0, harness;
  const memory = createOptChatMemory({ harness: () => harness, context, nodeBytes: 100, viewBytes: 4000, retryMs: 400, onError: (error, node) => reported.push([error.message, node.index]),
    summarizer: { summarize: async () => { if (++attempts === 1) throw new Error('flaky model'); return '~ short'; } } });
  const registry = createRegistry();
  registry.install(memory.extension);
  harness = await Harness.open(new MemoryStorage(), { registry, models: await answeringModels() }, context);
  t.after(async () => { await memory.dispose(); await harness.close(context); });
  const conversation = await harness.root(context, { agent: { model: { provider: 'scripted', modelId: 'scripted' }, extensions: [memory.extension] } });
  harness.resume();
  await (await conversation.submit({ type: 'input', content: `One long message. ${'Fictional filler text. '.repeat(10)}` }, context)).wait(context);
  const failedOnce = async () => (await memory.stats(conversation.id)).compactor;
  for (let i = 0; i < 200 && (await failedOnce()).failed === 0; i++) await new Promise(resolve => setTimeout(resolve, 20));
  const failed = await failedOnce();
  assert.deepEqual([failed.failed, failed.error, failed.retrying], [1, 'flaky model', 1]);
  assert.deepEqual(reported, [['flaky model', 0]], 'reported once');
  const before = attempts;
  await memory.nap(conversation.id); // inside the retry window: the node is left alone
  assert.equal(attempts, before, 'no retry inside retryMs');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(attempts, before, 'and nothing retries by itself afterwards: no timer');
  await memory.nap(conversation.id); // the next trigger
  const done = await memory.stats(conversation.id);
  assert.ok(attempts > before && done.summaries >= 1 && done.compactor.failed === 0 && done.compactor.idle, JSON.stringify(done.compactor));
});

test('the file guard wraps Pi\'s read, write and edit: stale and unread changes are refused, creating is allowed, baselines survive a restart', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-file-guard-'));
  const workspace = join(directory, 'workspace');
  mkdirSync(workspace);
  const env = new NodeExecutionEnv({ cwd: workspace });
  const journal = createWorkspaceJournal(openNodeConnection(join(directory, 'journal.sqlite')));
  const files = createWorkspaceProvider({ identity: { providerId: 'guarded', instanceId: 'one', incarnation: 'one', viewId: 'published' }, fs: env, journal });
  const person = { principalId: 'person', initiatorId: 'person', scopeId: 'fictional-project' };
  const guard = createFileGuard({ workspace: { files, root: workspace }, resolveAccess: () => access });
  const open = async () => {
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'fixture.files', tools: [createReadTool(), createWriteTool(), createEditTool()] }));
    registry.install(guard);
    return Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models: createModels(), env: () => env }, context);
  };
  let harness = await open();
  t.after(async () => { await harness.close(context); rmSync(directory, { recursive: true, force: true }); });
  const conversation = await harness.root(context);
  const run = async (name, args) => toolResultText(harness, conversation, await admitDocumentTool(conversation, args, name));
  const target = path => ({ resource: { providerId: 'guarded', path }, view: { kind: 'published' } });
  const onDisk = path => readFileSync(join(workspace, path), 'utf8');
  /** The person saves through the provider, as a viewer does. */
  const personSaves = async (path, text) => {
    const current = await files.read({ target: target(path), revision: { kind: 'latest' } }, person);
    const result = await files.publication.publish({ operationId: `person-${Math.random()}`, atomicity: 'all-or-nothing',
      changes: [{ kind: 'replace', target: current.snapshot.ref, bytes: new TextEncoder().encode(text), mediaType: 'text/markdown' }] }, person);
    assert.equal(result.kind, 'committed');
  };
  const edit = (path, oldText, newText) => run('edit', { path, edits: [{ oldText, newText }] });

  // Creating a file that is absent needs no read, and the written revision is the new baseline.
  assert.equal((await run('write', { path: 'a.md', content: 'one\ntwo\n' })).isError, false);
  assert.equal((await edit('a.md', 'two', 'two!')).isError, false, 'the baseline after a write is the revision written');
  assert.equal(onDisk('a.md'), 'one\ntwo!\n');
  // The person saves: the agent's change from memory is refused with the instruction to read again, and nothing changes.
  await personSaves('a.md', 'one\ntwo!\nHUMAN\n');
  const stale = await edit('a.md', 'one', 'ONE');
  assert.equal(stale.isError, true);
  assert.match(stale.text, /changed since you last read it/);
  assert.match(stale.text, /read it again/i);
  const staleWrite = await run('write', { path: 'a.md', content: 'overwritten' });
  assert.equal(staleWrite.isError, true);
  assert.equal(onDisk('a.md'), 'one\ntwo!\nHUMAN\n');
  // Read again, then the same edit lands and the person's line is kept.
  assert.equal((await run('read', { path: 'a.md' })).isError, false);
  assert.equal((await edit('a.md', 'one', 'ONE')).isError, false);
  assert.equal(onDisk('a.md'), 'ONE\ntwo!\nHUMAN\n');
  // A file that exists and was never read is refused, for write and for edit.
  writeFileSync(join(workspace, 'seed.md'), 'seeded\n');
  for (const refused of [await run('write', { path: 'seed.md', content: 'x' }), await edit('seed.md', 'seeded', 'x')]) {
    assert.equal(refused.isError, true);
    assert.match(refused.text, /have not read it/);
  }
  assert.equal(onDisk('seed.md'), 'seeded\n');
  // After a read, an edit that fails in Pi's own matching changes nothing and keeps the baseline.
  assert.equal((await run('read', { path: 'seed.md' })).isError, false);
  assert.equal((await edit('seed.md', 'not there', 'x')).isError, true);
  assert.equal(onDisk('seed.md'), 'seeded\n');
  // The baseline is durable: after a restart of the Harness the conversation may still change what it read.
  await harness.close(context);
  harness = await open();
  const reopened = await harness.conversation(conversation.id, context);
  const afterRestart = await toolResultText(harness, reopened, await admitDocumentTool(reopened, { path: 'seed.md', edits: [{ oldText: 'seeded', newText: 'seeded again' }] }, 'edit'));
  assert.equal(afterRestart.isError, false);
  assert.equal(onDisk('seed.md'), 'seeded again\n');
  // A change made behind the guard (a shell) moves the revision: the next change is refused until the file is read.
  writeFileSync(join(workspace, 'seed.md'), 'shell wrote this\n');
  assert.equal((await toolResultText(harness, reopened, await admitDocumentTool(reopened, { path: 'seed.md', edits: [{ oldText: 'shell', newText: 'x' }] }, 'edit'))).isError, true);
  // Outside the workspace nothing is written.
  const outside = await toolResultText(harness, reopened, await admitDocumentTool(reopened, { path: '../outside.md', content: 'x' }, 'write'));
  assert.equal(outside.isError, true);
  assert.equal(existsSync(join(directory, 'outside.md')), false);
});

// ---- @hachej/boring-agent/workspaces: the workspace of each call, resolved like Pi's env, on ONE harness.
test('per-call workspaces: one harness and one guard serve two owners, each conversation in its own workspace taken from its env (one host function); the cache opens once per key, keeps leased ones and closes idle ones; a call whose env is another instance is refused', { timeout: 30000 }, async t => {
  const { createWorkspaceCache, constantWorkspace, rootConversation, withWorkspace, workspaceOfEnv } = await import('@hachej/boring-agent/workspaces');
  const { createGitTool } = await import('@hachej/boring-agent/git');
  const { createEnvGitFs, createGitRepository } = await import('@hachej/boring-files/git');
  const { lastReadRevisions } = await import('@hachej/boring-agent/file-guard');
  const directory = mkdtempSync(join(tmpdir(), 'boring-per-call-'));
  const journal = createWorkspaceJournal(openNodeConnection(join(directory, 'journal.sqlite')));
  const opened = { a: 0, b: 0 }, closed = { a: 0, b: 0 };
  const owners = new Map();
  const cache = createWorkspaceCache({
    key: target => owners.get(String(target.conversationId)),
    open: owner => {
      opened[owner]++;
      const root = join(directory, owner);
      mkdirSync(root, { recursive: true });
      const env = new NodeExecutionEnv({ cwd: root });
      const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: owner, incarnation: 'one', viewId: 'published' }, fs: env, journal });
      // The owner's repository over the same env (isomorphic-git through Pi's FileSystem).
      const repository = createGitRepository({ fs: createEnvGitFs(env, context), directory: root, author: { name: 'Fictional', email: 'fixture@example.invalid' }, authorize: () => true });
      return { id: owner, files, root, env, repository, access: { principalId: 'agent', initiatorId: owner, scopeId: owner }, close: () => { closed[owner]++; } };
    },
    idleMs: 200,
  });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.files', tools: [createReadTool(), createWriteTool(), createEditTool()] }));
  // No `workspace` option: the guard and working_git take the workspace attached to the env Pi resolved for each call (`cache.env`).
  registry.install(createFileGuard());
  registry.install(defineExtension({ name: 'fixture.git', tools: [createGitTool()] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels(), env: cache.env }, context);
  t.after(async () => { await harness.close(context); await cache.close(); rmSync(directory, { recursive: true, force: true }); });
  const conversationOf = async owner => {
    const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    owners.set(String(conversation.id), owner);
    return conversation;
  };
  const [a, b] = [await conversationOf('a'), await conversationOf('b')];
  const run = async (conversation, name, args) => toolResultText(harness, conversation, await admitDocumentTool(conversation, args, name));
  const onDisk = (owner, path) => existsSync(join(directory, owner, path)) ? readFileSync(join(directory, owner, path), 'utf8') : undefined;

  // A writes notes.md in A's workspace; B does not see it and creates its own; neither touches the other's.
  assert.equal((await run(a, 'write', { path: 'notes.md', content: 'A only\n' })).isError, false);
  assert.equal(onDisk('a', 'notes.md'), 'A only\n');
  assert.equal(onDisk('b', 'notes.md'), undefined);
  assert.equal((await run(b, 'read', { path: 'notes.md' })).isError, true, 'B cannot read A\'s file: it is not in B\'s workspace');
  assert.equal((await run(b, 'write', { path: 'notes.md', content: 'B only\n' })).isError, false, 'B creates its own: absent in B\'s workspace');
  assert.equal((await run(a, 'edit', { path: 'notes.md', edits: [{ oldText: 'A only', newText: 'A again' }] })).isError, false);
  assert.deepEqual([onDisk('a', 'notes.md'), onDisk('b', 'notes.md')], ['A again\n', 'B only\n']);
  // Baselines stay per conversation, keyed by the workspace identity and the path.
  assert.deepEqual(Object.keys((await harness.snapshot(lastReadRevisions, a.id, context)).revisions), ['a:notes.md']);
  assert.deepEqual(Object.keys((await harness.snapshot(lastReadRevisions, b.id, context)).revisions), ['b:notes.md']);
  // One provider instance per key however many calls: opened once each.
  assert.deepEqual(opened, { a: 1, b: 1 });
  const leased = await cache.acquire('a', context);
  assert.equal(workspaceOfEnv(leased.workspace.env)?.files, leased.workspace.files, 'the cache attaches each workspace to its env');
  leased.release();
  assert.throws(() => withWorkspace(new NodeExecutionEnv({ cwd: directory }), { files: leased.workspace.files, root: directory, env: leased.workspace.env }), /another env/);
  assert.deepEqual(cache.keys().sort(), ['a', 'b']);

  // A viewer borrows A's workspace: it outlives the idle time while held; B, idle, closes. Releasing never closes it at once.
  const lease = await cache.acquire('a', context);
  assert.equal(lease.workspace.root, join(directory, 'a'));
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.deepEqual({ closed, keys: cache.keys() }, { closed: { a: 0, b: 1 }, keys: ['a'] });
  lease.release(); lease.release();
  assert.deepEqual(closed, { a: 0, b: 1 }, 'release returns the hold; it does not close');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.deepEqual({ closed, keys: cache.keys() }, { closed: { a: 1, b: 1 }, keys: [] });
  // The next call reopens the workspace (a new instance) and the file is still there.
  assert.equal((await run(a, 'read', { path: 'notes.md' })).isError, false);
  assert.deepEqual(opened, { a: 2, b: 1 });

  assert.equal(await rootConversation(harness, a.id, context), a.id, 'an ownerless conversation is its own root');
  // working_git: the repository of each call's own workspace; A's commit stays in A's folder.
  for (const args of [{ operation: 'init' }, { operation: 'add', path: 'notes.md' }, { operation: 'commit', message: 'A notes' }]) assert.equal((await run(a, 'working_git', args)).isError, false);
  assert.match((await run(a, 'working_git', { operation: 'log' })).text, /A notes/);
  assert.equal(existsSync(join(directory, 'b', '.git')), false);
  assert.equal((await run(b, 'working_git', { operation: 'log' })).isError, true, 'B has no repository yet: A\'s is not B\'s');

  // Coherence: a binding naming another env than the one Pi gave the call is refused, not written through.
  const other = new NodeExecutionEnv({ cwd: join(directory, 'a') });
  const incoherent = createRegistry();
  incoherent.install(defineExtension({ name: 'fixture.files', tools: [createReadTool(), createWriteTool(), createEditTool()] }));
  const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'x', incarnation: 'one', viewId: 'published' }, fs: other, journal });
  incoherent.install(createFileGuard({ workspace: constantWorkspace({ files, root: join(directory, 'a'), env: other, access: { principalId: 'agent', initiatorId: 'a', scopeId: 'a' } }) }));
  const second = await Harness.open(new MemoryStorage(), { registry: incoherent, models: createModels(), env: () => new NodeExecutionEnv({ cwd: join(directory, 'a') }) }, context);
  t.after(() => second.close(context));
  const root = await second.root(context);
  const refused = await toolResultText(second, root, await admitDocumentTool(root, { path: 'other.md', content: 'x' }, 'write'));
  assert.equal(refused.isError, true);
  assert.match(refused.text, /reopened during the call/);
  assert.equal(onDisk('a', 'other.md'), undefined);
});

// ---- @hachej/boring-agent/harness-pool: one harness per owner, opened on demand, closed when idle.
test('harness pool: one harness per owner, never shared; a held lease or a streaming response keeps it open; idle ones close; the next use reopens with the owner\'s durable state', { timeout: 30000 }, async t => {
  const { createHarnessPool } = await import('@hachej/boring-agent/harness-pool');
  const directory = mkdtempSync(join(tmpdir(), 'boring-harness-pool-'));
  const created = [], closedOwners = [];
  const pool = createHarnessPool({ context, idleMs: 200, create: async owner => {
    created.push(owner);
    const harness = await Harness.open(await openNodeSqliteStorage(join(directory, `${owner}.sqlite`)), { registry: createRegistry(), models: createModels() }, context);
    return { harness, owner, close: async () => { closedOwners.push(owner); await harness.close(context); } };
  } });
  t.after(async () => { await pool.close(); rmSync(directory, { recursive: true, force: true }); });
  const [first, again, other] = await Promise.all([pool.acquire('owner-a'), pool.acquire('owner-a'), pool.acquire('owner-b')]);
  assert.equal(first.owned.harness, again.owned.harness, 'one harness per owner, even when acquired concurrently');
  assert.notEqual(first.owned.harness, other.owned.harness, 'never shared between owners');
  assert.deepEqual(created.sort(), ['owner-a', 'owner-b']);
  const rootA = await first.owned.harness.root(context);
  other.release();
  // A response that streams (a watch) holds owner B's harness until its body ends.
  let push;
  const streaming = await pool.respond('owner-b', async () => new Response(new ReadableStream({ start(controller) { push = controller; } })));
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.deepEqual(closedOwners, [], 'held leases and an open stream keep both open');
  first.release(); again.release();
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.deepEqual(closedOwners, ['owner-a'], 'owner A, idle, closed; owner B still streams');
  push.close();
  await streaming.text();
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.deepEqual({ closed: closedOwners, open: pool.owners() }, { closed: ['owner-a', 'owner-b'], open: [] });
  // The next use opens owner A's harness again over the same storage: its conversation is still there.
  const reopened = await pool.use('owner-a', async owned => (await owned.harness.root(context)).id);
  assert.equal(reopened, rootA.id);
  assert.deepEqual(created, ['owner-a', 'owner-b', 'owner-a']);
});

test('self-evolution prompt assembly (SELF-3): the host instructions first and whole, the labelled and capped agent-written section last; a plain agent has none (SELF-1)', { timeout: 30000 }, async t => {
  const { defineAgent } = await import('@hachej/boring-agent/agents');
  const { createProvider } = await import('@earendil-works/pi-ai/models');
  const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai/utils/event-stream');
  const { getCurrentSystemPrompt } = await import('@earendil-works/pi-ai/utils/transcript');
  const directory = mkdtempSync(join(tmpdir(), 'boring-self-evolution-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, '.agent'), { recursive: true });
  writeFileSync(join(directory, '.agent/AGENTS.md'), `Always answer in one line.\n${'x'.repeat(20000)}`);
  const env = new NodeExecutionEnv({ cwd: directory });
  // A keyless model that records the system prompt each request carries.
  const MODEL = { id: 'scripted', name: 'Scripted', provider: 'scripted', api: 'scripted-api', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const prompts = [];
  const stream = (_model, request) => {
    prompts.push(getCurrentSystemPrompt(request.messages));
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    setTimeout(() => { events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: 'stop', message }); events.end(message); }, 5);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: MODEL.provider, models: [MODEL], auth: { apiKey: { name: 'keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  const model = { provider: 'scripted', modelId: 'scripted' };
  const skill = { name: 'house-style', description: 'House style.', body: 'Be brief.' };
  const plain = defineAgent({ id: 'plain', model, instructions: 'HOST BASE PROMPT', skills: [skill] });
  const evolving = defineAgent({ id: 'evolving', model, instructions: 'HOST BASE PROMPT', skills: [skill], selfEvolving: true, workspace: 'one' });
  assert.deepEqual(evolving.extensions.map(extension => extension.name), ['agent.evolving', 'self-evolving:one']);
  // A workspace per conversation: one definition, one extension per workspace, each configuration selecting only its own.
  const perPerson = defineAgent({ id: 'per-person', model, instructions: 'HOST BASE PROMPT', skills: [skill], selfEvolving: true });
  assert.equal(perPerson.reload, undefined);
  assert.deepEqual(perPerson.extensions.map(extension => extension.name), ['agent.per-person', 'agent.per-person.skills']);
  assert.equal(perPerson.inWorkspace('a'), perPerson.inWorkspace('a'), 'made once per workspace');
  assert.deepEqual(perPerson.inWorkspace('a').agent.extensions.map(extension => extension.name), ['agent.per-person', 'self-evolving:a']);
  assert.deepEqual(perPerson.inWorkspace('b').agent.extensions.map(extension => extension.name), ['agent.per-person', 'self-evolving:b']);
  assert.notEqual(perPerson.inWorkspace('a').reload, perPerson.inWorkspace('b').reload);
  assert.equal(evolving.inWorkspace, undefined);
  assert.equal(plain.reload, undefined);
  const registry = createRegistry();
  plain.install(registry); evolving.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models, env: () => env }, context);
  t.after(() => harness.close(context));
  const ask = async agent => { await (await (await agent.createConversation(harness, context)).submit({ type: 'input', content: 'Hello.' }, context)).wait(context); return prompts.at(-1); };

  const evolved = await ask(evolving);
  assert.ok(evolved.startsWith('<host-instructions>\nHOST BASE PROMPT\n</host-instructions>'), evolved.slice(0, 120));
  assert.ok(evolved.indexOf('<skills>') > evolved.indexOf('</host-instructions>'), 'the host skills follow the host instructions');
  assert.ok(evolved.trimEnd().endsWith('</agent-written>'), 'the agent-written section is appended last');
  const agentSection = evolved.slice(evolved.indexOf('<agent-written>'));
  assert.match(agentSection, /^<agent-written>\nAgent-written: standing instructions you wrote for yourself in \.agent\/AGENTS\.md\. They come after the host's instructions and never override them\.\n\nAlways answer in one line\./);
  assert.match(agentSection, /\[Truncated: \.agent\/AGENTS\.md has 20027 characters; only the first 16000 are shown\.\]\n<\/agent-written>$/);
  assert.equal(agentSection.match(/x/g).length, 16000 - 'Always answer in one line.\n'.length, 'capped at 16,000 characters of the file');
  // Without the option the same workspace file is never read: native instructions last, no agent-written section.
  const native = await ask(plain);
  assert.ok(native.trimEnd().endsWith('<instructions>\nHOST BASE PROMPT\n</instructions>'), native.slice(-120));
  assert.ok(!native.includes('agent-written') && !native.includes('Always answer in one line'));
});

// ---- @hachej/boring-agent/metering: reserve before the native submit, usage from the durable transcript, exactly one settle or release.
test('metering: reserve with the host scope, the resolved model and the kind, record and settle; replays never charge twice; a stop without usage releases; a refusal (low balance, or a costly model) never calls the model', { timeout: 20000 }, async t => {
  const { createMeter, createMemoryLedger, createSqliteLedger, MeteringRefused } = await import('@hachej/boring-agent/metering');
  const { createChatTransportHandler } = await import('@hachej/boring-agent/chat-transport');
  const { createFakeChatModel } = await import('@hachej/boring-testing/model');
  const fake = createFakeChatModel({ cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } });
  const connection = openNodeConnection(':memory:');
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  t.after(async () => { await harness.close(context); connection.close(); });
  // Model-aware admission: a fictional premium model holds ten times more, so a balance that still admits the default model refuses it.
  const holdMicros = input => input.model?.id === 'fictional-premium' ? 50_000 : 5000;
  const attributes = { plan: 'fictional-free', seats: 1 };
  // The memory ledger keys balances by the person (the default); the SQLite one pools the workspace with `balanceKey`.
  for (const [name, ledger, scopeOf] of [
    ['memory', createMemoryLedger({ holdMicros }), account => ({ userId: account, attributes })],
    ['sqlite', createSqliteLedger({ connection, holdMicros, balanceKey: scope => scope.workspaceId ?? scope.userId }), account => ({ userId: 'fictional-person', workspaceId: account, attributes })],
  ]) {
    const account = `fictional-${name}`, scope = scopeOf(account);
    await ledger.grant(account, 10_000, 'signup'); await ledger.grant(account, 10_000, 'signup');
    const calls = [], reserves = [];
    let outage = false;
    const sink = { ...ledger, ...Object.fromEntries(['reserveRun', 'recordUsage', 'settleRun', 'releaseRun'].map(key => [key, async input => {
      calls.push([key, input.usageId ?? input.reason ?? input.status ?? '']);
      if (key === 'reserveRun') reserves.push(input);
      else assert.deepEqual([input.userId, input.workspaceId, input.attributes], [scope.userId, scope.workspaceId, attributes], `${name}: ${key} carries the run's scope`);
      if (outage && key === 'recordUsage') throw new Error('fictional ledger outage');
      return ledger[key](input);
    }])) };
    const meter = createMeter({ sink, context, models: fake.models, markup: 1.5, onError: () => {} });
    const native = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
    assert.throws(() => meter.conversation(native, { userId: '' }), /userId/);
    assert.throws(() => meter.conversation(native, { userId: 'fictional', attributes: { nested: {} } }), /attributes/);
    const conversation = meter.conversation(native, scope);
    // reserve -> record -> settle: 1000 input + 500 output tokens at $1/$2 per million = 2000 micro-dollars, times the 1.5 markup.
    const submitted = await conversation.submit({ type: 'input', requestId: 'first', content: 'Fictional question' }, context);
    assert.equal((await ledger.balance(account)).heldMicros, 5000, `${name}: the hold is placed before the model runs`);
    (await fake.nextCall()).respond('Fictional answer', { input: 1000, output: 500 });
    await submitted.wait(context); await meter.flush();
    assert.deepEqual(await ledger.balance(account), { balanceMicros: 7000, heldMicros: 0, availableMicros: 7000 }, name);
    const entryId = (await native.commit(tx => tx.submissionByRequest(native.id, 'first'), context)).answer;
    assert.deepEqual(calls, [['reserveRun', ''], ['recordUsage', `entry:${native.id}:${entryId}`], ['settleRun', 'done']], name);
    // The reservation carries the host's scope, the model the run will use (resolved through Pi), the native kind and a preview.
    const { content: _content, ...reserved } = reserves[0];
    assert.deepEqual(reserved, { ...scope, conversationId: Number(native.id), requestId: 'first', runId: `run:${native.id}:first`,
      model: { provider: 'fictional-chat-provider', id: 'fictional-chat' }, kind: 'input', message: 'Fictional question' }, name);
    if (name === 'sqlite') assert.deepEqual({ ...connection.get('SELECT balance_key, user_id, workspace_id, attributes, model, kind FROM boring_metering_runs WHERE run_id = ?', `run:${native.id}:first`) },
      { balance_key: account, user_id: 'fictional-person', workspace_id: account, attributes: JSON.stringify(attributes), model: 'fictional-chat-provider/fictional-chat', kind: 'input' });
    // A client retry of the same request ID: same submission, same reservation, the usage replayed under its key, no second charge.
    const retried = await conversation.submit({ type: 'input', requestId: 'first', content: 'Fictional question' }, context);
    assert.equal(retried.id, submitted.id); await meter.flush();
    const replay = { ...scope, conversationId: Number(native.id), requestId: 'first', runId: `run:${native.id}:first`, usageId: `entry:${native.id}:${entryId}`, bucket: 'x', usage: {}, amountMicros: 999_999 };
    assert.equal((await ledger.recordUsage(replay)).billedMicros, 3000);
    assert.equal((await ledger.balance(account)).balanceMicros, 7000, `${name}: replays never charge twice`);
    // 7000 available: the person selects the premium model, the reservation sees it and the ledger refuses it; nothing reaches the
    // conversation. Back on the default model the next messages are admitted.
    await native.configure({ model: { provider: 'fictional-chat-provider', modelId: 'fictional-premium' } }, context);
    await assert.rejects(conversation.submit({ type: 'input', requestId: 'premium', content: 'A premium question' }, context), error => error instanceof MeteringRefused && /needs 0\.0500/.test(error.message));
    assert.deepEqual(reserves.at(-1).model, { provider: 'fictional-chat-provider', id: 'fictional-premium' });
    assert.equal(await native.commit(tx => tx.submissionByRequest(native.id, 'premium'), context), undefined);
    await native.configure({ model: fake.model }, context);
    // A person's stop before any usage: the hold is freed, nothing charged.
    calls.length = 0;
    const stopped = await conversation.submit({ type: 'input', requestId: 'second', content: 'Fictional long question' }, context);
    (await fake.nextCall()).append('partial words');
    await native.abort(context);
    await stopped.wait(context); await meter.flush();
    assert.deepEqual(calls.map(([key, detail]) => key === 'recordUsage' ? key : `${key}:${detail}`), ['reserveRun:', 'releaseRun:cancelled'], name);
    assert.deepEqual(await ledger.balance(account), { balanceMicros: 7000, heldMicros: 0, availableMicros: 7000 }, name);
    // A usage report the ledger keeps refusing: the run cannot close free, so its hold is charged instead.
    calls.length = 0; outage = true;
    const lost = await conversation.submit({ type: 'input', requestId: 'lost', content: 'Fictional question again', whenBusy: 'followUp' }, context);
    assert.equal(reserves.at(-1).kind, 'followUp', `${name}: the native submission kind`);
    (await fake.nextCall()).respond('Fictional answer', { input: 1000, output: 500 });
    await lost.wait(context); await meter.flush(); outage = false;
    assert.deepEqual([...new Set(calls.map(([key, detail]) => key === 'recordUsage' ? key : `${key}:${detail}`))], ['reserveRun:', 'recordUsage', 'releaseRun:usage-write-failed'], name);
    assert.deepEqual(await ledger.balance(account), { balanceMicros: 2000, heldMicros: 0, availableMicros: 2000 }, name);
    // Exhausted: a refused reservation throws before the native submit; the model is never called and nothing is recorded.
    await ledger.grant(account, -1000, 'fictional-spend');
    const modelCalls = fake.calls.length;
    await assert.rejects(conversation.submit({ type: 'input', requestId: 'third', content: 'One more' }, context), error => error instanceof MeteringRefused && /Not enough credits/.test(error.message));
    // Through the chat transport the refusal is a 402 carrying the ledger's words, and still nothing reaches the conversation.
    const handler = createChatTransportHandler({ authenticate: async () => ({ conversation, context }) });
    const response = await handler(new Request('http://fixture.invalid/chat?op=submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'fourth', content: 'And another' }) }));
    assert.equal(response.status, 402);
    const refused = await response.json();
    assert.equal(refused.reason, 'submission-refused'); assert.match(refused.message, /Not enough credits/);
    assert.equal(fake.calls.length, modelCalls, `${name}: a refused run never calls the model`);
    assert.equal(await native.commit(tx => tx.submissionByRequest(native.id, 'third'), context), undefined);
    assert.deepEqual(await ledger.openRuns(), []);
    await meter.close();
  }
});

// Several processes reserving against one ledger file at once: every write is a write transaction, so they serialize (busy
// timeout) instead of failing with SQLITE_BUSY, and a balance check and its hold commit together (no credit spent twice).
for (const [label, sqlite] of [['local disk WAL (default)', {}], ['rollback journal, shared locking (several processes on a network file system)', { journalMode: 'delete', lockingMode: 'normal', busyTimeoutMs: 20000 }]]) {
  test(`metering: four processes reserving concurrently on one SQLite ledger file, ${label}: no busy error, no overspend`, { timeout: 60000 }, async t => {
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { createSqliteLedger } = await import('@hachej/boring-agent/metering');
    const directory = mkdtempSync(join(tmpdir(), 'boring-metering-concurrent-'));
    const filename = join(directory, 'credits.sqlite'), go = join(directory, 'go');
    const HOLD = 1000, AFFORDABLE = 150, PROCESSES = 4, EACH = 100;
    const ledger = createSqliteLedger({ filename, sqlite, holdMicros: HOLD });
    t.after(() => { ledger.close(); rmSync(directory, { recursive: true, force: true }); });
    await ledger.grant('fictional-account', HOLD * AFFORDABLE, 'signup');
    const script = `import { existsSync } from 'node:fs';
import { createSqliteLedger } from '@hachej/boring-agent/metering';
const [filename, go, worker, each, sqlite] = process.argv.slice(1);
const ledger = createSqliteLedger({ filename, sqlite: JSON.parse(sqlite), holdMicros: ${HOLD} });
while (!existsSync(go)) await new Promise(resolve => setTimeout(resolve, 5));
const outcomes = { admitted: 0, refused: 0, errors: [] };
for (let index = 0; index < Number(each); index++) {
  try {
    const reservation = await ledger.reserveRun({ userId: 'fictional-account', kind: 'input', message: 'Fictional question', content: 'Fictional question', conversationId: Number(worker), requestId: 'r' + index, runId: 'run:' + worker + ':' + index });
    if (reservation.kind === 'refused') outcomes.refused++; else outcomes.admitted++;
  } catch (error) { outcomes.errors.push(String(error.message)); }
}
ledger.close();
console.log(JSON.stringify(outcomes));`;
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const children = Array.from({ length: PROCESSES }, (_, worker) => {
      const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, filename, go, String(worker + 1), String(EACH), JSON.stringify(sqlite)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
      return new Promise(resolve => child.on('close', code => resolve({ code, out, err })));
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    writeFileSync(go, '');
    const results = await Promise.all(children);
    for (const result of results) assert.equal(result.code, 0, result.err);
    const outcomes = results.map(result => JSON.parse(result.out.trim()));
    assert.deepEqual(outcomes.flatMap(outcome => outcome.errors), [], 'no reservation failed (no SQLITE_BUSY)');
    assert.equal(outcomes.reduce((total, outcome) => total + outcome.admitted, 0), AFFORDABLE, 'exactly the affordable number of runs was admitted');
    assert.equal(outcomes.reduce((total, outcome) => total + outcome.refused, 0), PROCESSES * EACH - AFFORDABLE, 'every other reservation was refused');
    assert.deepEqual(await ledger.balance('fictional-account'), { balanceMicros: HOLD * AFFORDABLE, heldMicros: HOLD * AFFORDABLE, availableMicros: 0 });
    assert.equal((await ledger.openRuns()).length, AFFORDABLE);
  });
}

for (const phase of ['interrupt', 'settle']) test(`metering: a run killed ${phase === 'interrupt' ? 'mid-generation is charged its hold (unknown usage)' : 'between record and settle is settled once'} after a restart`, { timeout: 30000 }, async t => {
  const { spawn } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'boring-metering-crash-'));
  const script = new URL('../fixtures/metering-crash-child.mjs', import.meta.url).pathname;
  const children = [];
  const start = name => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [script, directory, name], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    children.push(child); return { child, exited };
  };
  t.after(() => { for (const child of children) child.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); });
  const first = start(phase);
  if (phase === 'interrupt') {
    const until = Date.now() + 15000;
    while (!existsSync(join(directory, 'ready.json'))) { assert.ok(Date.now() < until, 'the partial was not committed'); await new Promise(resolve => setTimeout(resolve, 20)); }
    const ready = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
    assert.equal(ready.open.length, 1);
    assert.equal(ready.balance.heldMicros, 5000);
    first.child.kill('SIGKILL');
  }
  assert.deepEqual(await first.exited, { code: null, signal: 'SIGKILL' });
  assert.deepEqual(await start('recover').exited, { code: 0, signal: null });
  const result = JSON.parse(readFileSync(join(directory, 'recovered.json'), 'utf8'));
  assert.equal(result.before.open.length, 1, 'the run was still open in the ledger after the crash');
  // The open run keeps the host's scope across the crash, so `recover` settles or releases it under the same person and workspace.
  const { conversationId: _conversation, ...open } = result.before.open[0];
  assert.deepEqual(open, { userId: 'fictional-person', workspaceId: 'fictional-workspace', attributes: { plan: 'fictional-free' }, requestId: 'fictional-request', runId: open.runId, reservationId: open.runId });
  assert.equal(result.record.status, 'done');
  if (phase === 'interrupt') {
    // The lost attempt's usage is unknown (an aborted partial): the run is charged its hold, which covers the retried answer's 2000.
    assert.deepEqual(result.runs.map(run => [run.state, run.reason]), [['charged', 'fallback-charge']]);
    assert.equal(result.charges.reduce((sum, charge) => sum + charge.amount, 0), 5000);
    assert.equal(result.calls, 1, 'the model answered once after recovery');
  } else {
    assert.deepEqual(result.runs.map(run => [run.state, run.reason]), [['settled', 'done']]);
    assert.equal(result.charges.length, 1, 'the recorded usage was replayed under its key, not charged again');
    assert.equal(result.calls, 0, 'nothing ran again');
  }
  const left = phase === 'interrupt' ? 95_000 : 98_000;
  assert.deepEqual(result.balance, { balanceMicros: left, heldMicros: 0, availableMicros: left });
});

/** Models whose one provider answers `Echo: <last user text>`, so a conversation's last message is predictable without a real model. */
async function echoModels() {
  const { createProvider } = await import('@earendil-works/pi-ai/models');
  const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai/utils/event-stream');
  const MODEL = { id: 'echo', name: 'Echo', provider: 'echo', api: 'echo-api', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const stream = (_model, transcript) => {
    const user = [...transcript.messages].reverse().find(message => message.role === 'user');
    const said = typeof user.content === 'string' ? user.content : user.content.map(part => part.text ?? '').join('');
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [{ type: 'text', text: `Echo: ${said}` }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    setTimeout(() => { events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: 'stop', message }); events.end(message); }, 2);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: MODEL.provider, models: [MODEL], auth: { apiKey: { name: 'keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, model: { provider: 'echo', modelId: 'echo' } };
}

test('conversations: metadata in one native document per conversation; list, search, rename, archive, fork and delete survive a restart', { timeout: 30000 }, async t => {
  const { createConversations, createConversationsHandler, conversationMetadata } = await import('@hachej/boring-agent/conversations');
  const directory = mkdtempSync(join(tmpdir(), 'conversations-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { models, model } = await echoModels();
  let clock = 1_000;
  const open = async () => {
    const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry: createRegistry(), models }, context);
    return { harness, conversations: createConversations({ harness, context, now: () => ++clock }) };
  };
  const team = 'fictional-team', other = 'fictional-other-team';
  const start = harness => init => harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model }, init }, context);
  const say = async (conversation, text) => (await conversation.submit({ type: 'input', content: text }, context)).wait(context);

  let { harness, conversations } = await open();
  const first = await conversations.create(team, { start: start(harness) });
  const second = await conversations.create(team, { start: start(harness) });
  const foreign = await conversations.create(other, { start: start(harness), title: 'Other team chat' });
  // Untitled until the first user message; then the title is derived once and stays.
  assert.equal((await conversations.get(team, first.id)).title, null);
  await say(first, 'Plan the lantern walk');
  await say(first, 'Add a stop at the quartz fountain');
  await say(second, 'Draft the river notice');
  await conversations.flush();
  const one = await conversations.get(team, first.id);
  assert.equal(one.title, 'Plan the lantern walk', 'title from the first user message, not the last');
  assert.equal(one.lastMessage, 'Echo: Add a stop at the quartz fountain', 'preview of the last assistant message');
  assert.equal((await conversations.list({ owner: team })).items.map(item => item.id).join(), [second.id, first.id].join(), 'newest activity first');
  assert.deepEqual((await conversations.list({ owner: other })).items.map(item => item.title), ['Other team chat'], 'owner scoping');
  // A conversation this module did not create is not listed and gets no metadata document from turns.
  const unmanaged = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model } }, context);
  await say(unmanaged, 'Unlisted chat');
  await conversations.flush();
  assert.equal(await harness.snapshot(conversationMetadata, unmanaged.id, context), undefined);

  // Rename, server-side search over title and last message, archive.
  assert.equal((await conversations.rename(team, second.id, 'River notice')).title, 'River notice');
  assert.equal(await conversations.rename(other, second.id, 'Stolen'), undefined, 'another owner cannot rename');
  assert.deepEqual((await conversations.list({ owner: team, query: 'QUARTZ' })).items.map(item => item.id), [first.id], 'a word of the last message');
  assert.deepEqual((await conversations.list({ owner: team, query: 'river' })).items.map(item => item.id), [second.id], 'a word of the title');
  await conversations.archive(team, first.id);
  assert.deepEqual((await conversations.list({ owner: team })).items.map(item => item.id), [second.id], 'archived ones are hidden');
  assert.deepEqual((await conversations.list({ owner: team, archived: true })).items.map(item => item.id), [first.id]);
  await conversations.archive(team, first.id, false);

  // Fork at the first answer: the history up to that entry, a derived title, and it keeps working with the same agent.
  const page = await first.entries({}, 50, undefined, context);
  const firstAnswer = page.items.filter(entry => entry.model?.some(message => message.role === 'assistant')).at(-1);
  const fork = await conversations.fork(team, first.id, firstAnswer.id);
  const forked = await conversations.get(team, fork.id);
  assert.equal(forked.title, 'Plan the lantern walk (fork)');
  assert.equal(forked.lastMessage, 'Echo: Plan the lantern walk');
  const texts = async conversation => (await conversation.entries({}, 50, undefined, context)).items.flatMap(entry => entry.model ?? []).map(message => typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('')).reverse();
  assert.deepEqual(await texts(fork), ['Plan the lantern walk', 'Echo: Plan the lantern walk']);
  await say(fork, 'Continue from here');
  await conversations.flush();
  assert.equal((await conversations.get(team, fork.id)).lastMessage, 'Echo: Continue from here');
  assert.equal((await conversations.get(team, first.id)).lastMessage, 'Echo: Add a stop at the quartz fountain', 'the source is unchanged');

  // Delete is a durable mark (Pi keeps the records): hidden from the list, `get` and `open`.
  assert.equal(await conversations.delete(other, second.id), false);
  assert.equal(await conversations.delete(team, second.id), true);
  assert.equal(await conversations.open(team, second.id), undefined);
  assert.ok(await harness.conversation(second.id, context), 'the native records are retained');

  // The HTTP handler: owner from the host's authentication, JSON-only POSTs.
  const handler = createConversationsHandler({ conversations, authenticate: async request => request.headers.get('authorization') === 'Bearer fictional' ? { owner: team, start: start(harness) } : null });
  const call = (op, body) => handler(new Request(`https://fixture.invalid/conversations${op ? `?op=${op}` : ''}`, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer fictional', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  assert.equal((await handler(new Request('https://fixture.invalid/conversations'))).status, 401);
  assert.equal((await handler(new Request('https://fixture.invalid/conversations?op=rename', { method: 'POST', headers: { authorization: 'Bearer fictional' }, body: '{}' }))).status, 415);
  assert.deepEqual((await (await call()).json()).conversations.map(item => item.id), [fork.id, first.id]);
  assert.deepEqual((await (await handler(new Request('https://fixture.invalid/conversations?q=fountain', { headers: { authorization: 'Bearer fictional' } }))).json()).conversations.map(item => item.id), [first.id]);
  assert.equal((await call('rename', { conversationId: foreign.id, title: 'Mine now' })).status, 404, 'another owner\'s conversation is unknown');
  assert.equal((await (await call('rename', { conversationId: first.id, title: 'Lantern walk' })).json()).conversation.title, 'Lantern walk');
  const made = (await (await call('create', {})).json()).conversationId;
  assert.equal((await call('delete', { conversationId: made })).status, 200);
  assert.equal((await call('fork', { conversationId: first.id, at: 'x' })).status, 400);

  // Restart: everything above is in the native documents.
  await conversations.dispose();
  await harness.close(context);
  ({ harness, conversations } = await open());
  t.after(async () => { await conversations.dispose(); await harness.close(context); });
  const after = (await conversations.list({ owner: team, archived: 'all' })).items;
  assert.deepEqual(after.map(item => [item.id, item.title, item.lastMessage]), [
    [fork.id, 'Plan the lantern walk (fork)', 'Echo: Continue from here'],
    [first.id, 'Lantern walk', 'Echo: Add a stop at the quartz fountain'],
  ]);
  // Adopting an existing conversation (a host migrating its own index) derives title and preview once from the history.
  const adopted = await conversations.adopt(unmanaged.id, team, { updatedAt: 5 });
  assert.equal(adopted.title, 'Unlisted chat');
  assert.equal(adopted.lastMessage, 'Echo: Unlisted chat');
  assert.equal(await conversations.adopt(foreign.id, team), undefined, 'a conversation another owner manages is not taken over');
  // Paging by cursor, newest first.
  const firstPage = await conversations.list({ owner: team, limit: 2 });
  const nextPage = await conversations.list({ owner: team, limit: 2, cursor: firstPage.next });
  assert.deepEqual([...firstPage.items, ...nextPage.items].map(item => item.id), [fork.id, first.id, unmanaged.id]);
  assert.equal(nextPage.next, undefined);
});
