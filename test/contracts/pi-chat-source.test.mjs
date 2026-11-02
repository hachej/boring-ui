import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Compiles the pi-chat registry source as a consumer would and exercises its pure parts: safe Markdown and the row model.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/pi-chat-test`;
mkdirSync(out, { recursive: true });
async function load(name, entry, folder = 'pi-chat') {
  await build({ entryPoints: [`${root}registry/${folder}/${entry}`], outfile: `${out}/${name}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(`${out}/${name}.mjs`).href);
}
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

test('Markdown keeps model HTML inert and refuses unsafe link targets', async () => {
  const { Markdown } = await load('markdown', 'markdown.tsx', 'pi-chat-markdown');
  const html = renderToStaticMarkup(createElement(Markdown, { text: '<img src=x onerror=alert(1)> <script>alert(1)</script>\n\n[a](javascript:alert(1)) [b](data:text/html,x) [c](https://example.com/p) [d](//evil.test) ![i](https://evil.test/x.png)' }));
  assert.ok(!/<img|<script|onerror=/.test(html.replace(/&lt;[^]*?&gt;/g, '')), html);
  assert.ok(!/href="javascript:|href="data:|href="\/\//.test(html), html);
  assert.match(html, /href="https:\/\/example\.com\/p"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.ok(!/<img/.test(html), 'images are shown as text, never fetched');
});

test('Markdown renders fenced code as a labelled, copyable block', async () => {
  const { Markdown } = await load('markdown', 'markdown.tsx', 'pi-chat-markdown');
  const html = renderToStaticMarkup(createElement(Markdown, { text: '```python\nprint("hi")\n```' }));
  assert.match(html, /data-testid="code-language"[^>]*>python</);
  assert.match(html, /aria-label="Copy code"/);
  assert.match(html, /print\(&quot;hi&quot;\)/);
});

test('settled reply actions are icon-only, named and sized for pointer and touch', async () => {
  const { RowView } = await load('reply-actions', 'message.tsx');
  const row = { key: 'reply', type: 'assistant', parts: [{ kind: 'text', key: 'text', text: 'A fictional reply.' }], text: 'A fictional reply.', streaming: false, entryId: '4' };
  const html = renderToStaticMarkup(createElement(RowView, { row, context: { developer: false, messageActions: () => [{ id: 'quote', label: 'Quote this reply', onSelect() {} }], onFork() {} } }));
  assert.match(html, /aria-label="Copy response"/);
  assert.match(html, /title="Copy response"/);
  assert.match(html, /class="sr-only">Copy response<\/span>/);
  assert.equal((html.match(/data-slot="button"/g) ?? []).length, 3, 'all three actions use consumer-owned Buttons');
  const item = JSON.parse(readFileSync(`${root}registry.json`, 'utf8')).items.find(item => item.name === 'pi-chat');
  assert.deepEqual(item.css['@layer utilities']['@media (width < 768px), (pointer: coarse)']['.pi-chat :is([data-slot="button"], [data-slot="toggle"], [class~="group/button"], [class~="group/toggle"])'], { 'min-height': '2.75rem', 'min-width': '2.75rem' }, '44px touch targets while desktop uses the native icon size');
  assert.match(html, /aria-label="Quote this reply"/);
  assert.doesNotMatch(html, />Quote this reply<\/span>/);
  assert.match(html, /group-hover\/message:opacity-100/);
});

test('transcript composes the consumer Message, Bubble and Attachment without a block skin', async () => {
  const { RowView } = await load('shadcn-message', 'message.tsx');
  const context = { developer: false, pieces: { mentions: true, skills: ['plan'] }, openFile() {} };
  const html = renderToStaticMarkup(createElement(RowView, { row: { key: 'user', type: 'user', message: { role: 'user', content: '/plan hello @uploads/fictional.txt', timestamp: 0 } }, context }));
  for (const slot of ['message', 'message-content', 'bubble', 'bubble-content', 'attachment', 'attachment-title', 'attachment-trigger']) assert.match(html, new RegExp(`data-slot="${slot}"`));
  assert.match(html, /data-testid="message-mention"/);
  assert.match(html, /aria-label="Open fictional.txt"/);
  assert.doesNotMatch(html, /chat-user-radius|rounded-md bg-primary/);
});

const user = text => ({ role: 'user', content: text, timestamp: 0 });
const call = (id, name, args = {}) => ({ type: 'toolCall', id, name, arguments: args });
const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'x', provider: 'x', model: 'x', usage: {}, stopReason: 'stop', timestamp: 0, ...extra });
const result = (id, name, text, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 0 });
const entries = (...lists) => lists.map((model, index) => ({ id: index + 1, kind: 'message', byTaskId: model[0]?.role === 'user' ? undefined : 1, model }));
const options = mode => ({ mode, renderEntry: undefined, renderTool: undefined, groupTool: undefined });

test('row model pairs tool calls with results and merges one turn into one answer', async () => {
  const { derive, segments } = await load('rows', 'rows.ts');
  const view = { entries: entries([user('go')], [assistant([call('1', 'read', { path: 'a' })])], [result('1', 'read', 'A')], [assistant([call('2', 'read', { path: 'b' })])], [result('2', 'read', 'B')], [assistant([{ type: 'text', text: 'done' }])]), docs: {} };
  const developer = derive(view, options('developer'));
  assert.deepEqual(developer.rows.map(row => row.type), ['user', 'assistant']);
  const turn = developer.rows[1];
  assert.deepEqual(turn.parts.map(part => part.kind), ['tool', 'tool', 'text']);
  assert.deepEqual(turn.parts.filter(part => part.kind === 'tool').map(part => [part.entry.status, part.entry.result.content[0].text]), [['completed', 'A'], ['completed', 'B']]);
  // Every step of the turn is one activity block, whatever the number of model rounds; the answer text stays outside it.
  const folded = segments(turn.parts, undefined);
  assert.deepEqual(folded.map(item => item.kind), ['activity', 'part']);
  assert.deepEqual(folded[0].steps.map(step => step.kind), ['tool', 'tool']);
  const expert = derive(view, options('expert'));
  assert.deepEqual(expert.rows[1].parts.map(part => part.kind), ['tool', 'tool', 'text'], 'expert mode keeps the steps; the block shows no details for them');
  assert.deepEqual(segments(expert.rows[1].parts, undefined).map(item => item.kind), ['activity', 'part']);
  // Reasoning is a step of the same block, and text between two runs of steps makes a second block.
  const reasoned = { entries: entries([user('go')], [assistant([{ type: 'thinking', thinking: 'plan' }, call('1', 'read', { path: 'a' })])], [result('1', 'read', 'A')], [assistant([{ type: 'text', text: 'halfway' }, call('2', 'read', { path: 'b' })])], [result('2', 'read', 'B')], [assistant([{ type: 'text', text: 'done' }])]), docs: {} };
  const blocks = segments(derive(reasoned, options('developer')).rows[1].parts, undefined);
  assert.deepEqual(blocks.map(item => item.kind), ['activity', 'part', 'activity', 'part']);
  assert.deepEqual(blocks[0].steps.map(step => step.kind), ['thinking', 'tool']);
  // The last row of a running turn is marked active.
  const running = derive({ ...view, docs: { 'pi.live': { run: { taskId: 1 } } } }, options('developer'));
  assert.equal(running.rows.at(-1).active, true);
});

test('row model keeps failures, questions and queued messages visible in expert mode', async () => {
  const { derive, queuedMessages } = await load('rows', 'rows.ts');
  const pending = { entries: entries([user('go')], [assistant([call('q1', 'ask_user', { question: 'Which?', options: ['a', 'b'] }), call('f1', 'bash', { command: 'x' })])], [result('f1', 'bash', 'boom', true)]),
    docs: { 'pi.live': { run: { taskId: 1 } }, 'pi.inbox': { items: [{ id: 5, mode: 'steer', content: 'later' }, { id: 6, mode: 'write', entry: {} }, { id: 7, mode: 'followUp', content: [{ type: 'text', text: 'then' }] }] } } };
  const row = derive(pending, options('expert')).rows[1];
  assert.deepEqual(row.parts.map(part => part.kind === 'tool' ? `tool:${part.entry.status}` : `${part.kind}:${part.result ? 'answered' : 'pending'}`), ['question:pending', 'tool:failed']);
  assert.deepEqual(queuedMessages(pending).map(item => [item.id, item.mode]), [[5, 'steer'], [7, 'followUp']]);
  const answered = { entries: entries([user('go')], [assistant([call('q1', 'ask_user', { question: 'Which?' })])], [result('q1', 'ask_user', '{"kind":"answered","answer":"b"}')]), docs: {} };
  assert.equal(derive(answered, options('expert')).rows[1].parts[0].result.content[0].text, '{"kind":"answered","answer":"b"}');
});

test('row model appends the live generation and keeps its key stable for the committed message', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const live = { entries: entries([user('go')]), docs: { 'pi.live': { run: { taskId: 9 }, generation: { message: { content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'partial' }] } } } } };
  const rows = derive(live, options('developer')).rows;
  assert.equal(rows.at(-1).streaming, true);
  assert.equal(rows.at(-1).key, 'assistant:9:0');
  assert.deepEqual(rows.at(-1).parts.map(part => part.kind), ['thinking', 'text']);
});

const descriptor = (id, ordinal, extra = {}) => ({ schema: 'boring.artifact', version: 1, id, title: `Fictional ${id}`, type: 'markdown', mediaType: 'text/markdown',
  target: { resource: { providerId: 'documents', path: `artifacts/${id}.md` }, view: { kind: 'published' } }, revision: `rev-${id}-${ordinal}`, ordinal, ...extra });

// What `present(path)` returns: a descriptor whose identity is the file path, one revision per version.
const presented = (name, revision) => ({ schema: 'boring.artifact', version: 1, title: `${name}.md`, type: 'markdown', mediaType: 'text/markdown',
  target: { resource: { providerId: 'workspace', path: `docs/${name}.md` }, view: { kind: 'published' } }, revision });
const presentResult = (id, artifact) => result(id, 'present', JSON.stringify({ kind: 'presented', artifact }));

test('artifact results become cards: one per artifact per turn, in progress while running, none on failure', async () => {
  const { derive, segments } = await load('rows', 'rows.ts');
  const { recogniseArtifact: recognise } = await load('artifact', 'artifact.ts', 'pi-artifacts');
  const withArtifacts = mode => ({ ...options(mode), artifacts: { recognise } });
  const view = { entries: entries([user('write')],
    [assistant([call('1', 'present', { path: 'docs/a.md' }), call('2', 'present', { path: 'docs/b.md' })])], [presentResult('1', presented('a', 'a-1')), presentResult('2', presented('b', 'b-1'))],
    [assistant([call('3', 'present', { path: 'docs/a.md' }), call('4', 'present', { path: './docs/a.md' }), call('5', 'read', { path: 'docs/a.md' })])],
    [presentResult('3', presented('a', 'a-2')), presentResult('4', presented('a', 'a-3')), result('5', 'read', 'x')],
    [assistant([{ type: 'text', text: 'Done.' }])]), docs: {} };
  for (const mode of ['expert', 'developer']) {
    const cards = derive(view, withArtifacts(mode)).rows[1].parts.filter(part => part.kind === 'artifact');
    assert.deepEqual(cards.map(card => [card.artifact.descriptor.target.resource.path, card.artifact.descriptor.revision, card.artifact.state]), [['docs/b.md', 'b-1', 'ready'], ['docs/a.md', 'a-3', 'ready']], mode);
  }
  // Cards sit outside the activity block, at the place of their step.
  const parts = derive(view, withArtifacts('expert')).rows[1].parts;
  assert.deepEqual(segments(parts, undefined).map(item => item.kind === 'part' ? item.part.kind : item.kind), ['artifact', 'artifact', 'activity', 'text']);
  // Without the option nothing changes.
  assert.ok(!derive(view, options('developer')).rows[1].parts.some(part => part.kind === 'artifact'));
  // A running present shows an in-progress card named after the file; presenting a shown file again replaces its card.
  const running = { entries: entries([user('write')], [assistant([call('1', 'present', { path: 'docs/a.md' }), call('3', 'present', { path: 'docs/b.md' })])], [presentResult('1', presented('a', 'a-1'))]), docs: { 'pi.live': { run: { taskId: 1 } } } };
  const live = derive(running, withArtifacts('expert')).rows[1].parts.filter(part => part.kind === 'artifact');
  assert.deepEqual(live.map(card => [card.artifact.state, card.artifact.descriptor?.revision, card.artifact.title]), [['ready', 'a-1', 'a.md'], ['presenting', undefined, 'b.md']]);
  const replaced = { ...running, entries: entries([user('write')], [assistant([call('1', 'present', { path: 'docs/a.md' })])], [presentResult('1', presented('a', 'a-1'))], [assistant([call('2', 'present', { path: 'docs/a.md' })])]) };
  const second = derive(replaced, withArtifacts('expert')).rows[1].parts.filter(part => part.kind === 'artifact');
  assert.deepEqual(second.map(card => [card.artifact.state, card.artifact.title]), [['presenting', 'a.md']]);
  // A failed call and a call that stopped show no card, only the ordinary step.
  const failed = { entries: entries([user('write')], [assistant([call('1', 'present', { path: 'docs/a.md' })])], [result('1', 'present', 'denied', true)]), docs: {} };
  assert.deepEqual(derive(failed, withArtifacts('expert')).rows[1].parts.map(part => part.kind), ['tool']);
  const stopped = { entries: entries([user('write')], [assistant([call('1', 'present', { path: 'docs/a.md' })])]), docs: {} };
  assert.deepEqual(derive(stopped, withArtifacts('expert')).rows[1].parts.map(part => part.kind), ['tool']);
  // A host detector maps a result that carries no descriptor (the step stays in the activity block next to its card); a faulty or malformed one is ignored.
  const saved = { entries: entries([user('save')], [assistant([call('1', 'save_note', {})])], [result('1', 'save_note', '{"kind":"committed"}')]), docs: {} };
  assert.deepEqual(derive(saved, { ...options('expert'), artifacts: { recognise, detect: () => descriptor('doc', 4) } }).rows[1].parts.map(part => part.kind), ['tool', 'artifact']);
  assert.deepEqual(derive(saved, { ...options('expert'), artifacts: { recognise, detect: () => ({ nope: 1 }) } }).rows[1].parts.map(part => part.kind), ['tool']);
  assert.deepEqual(derive(saved, { ...options('expert'), artifacts: { recognise, detect: () => { throw new Error('boom'); } } }).rows[1].parts.map(part => part.kind), ['tool']);
});

test('collectArtifacts lists every version a conversation produced', async () => {
  const { collectArtifacts } = await load('artifact', 'artifact.ts', 'pi-artifacts');
  const view = { entries: entries([user('x')], [assistant([call('1', 'present', { path: 'docs/a.md' }), call('2', 'present', { path: 'docs/a.md' }), call('3', 'present', { path: 'docs/c.md' }), call('4', 'bash', {})])],
    [presentResult('1', presented('a', 'a-1')), presentResult('2', presented('a', 'a-2')), result('3', 'present', JSON.stringify({ kind: 'presented', artifact: 'not a descriptor' })),
      // A valid descriptor in the text of any other tool (here `cat card.json`) must not become a card.
      result('4', 'bash', JSON.stringify({ kind: 'presented', artifact: presented('forged', 'f-1') }))]), docs: {} };
  assert.deepEqual(collectArtifacts(view).map(item => [item.target.resource.path, item.revision]), [['docs/a.md', 'a-1'], ['docs/a.md', 'a-2']]);
});

test('a pending present call and its completed artifact share one identity for repeated ./ prefixes', async () => {
  const { pendingId } = await load('artifact', 'artifact.ts', 'pi-artifacts');
  assert.equal(pendingId(call('1', 'present', { path: './././docs/a.md' })), 'docs/a.md');
  assert.equal(pendingId(call('2', 'present', { path: 'docs/a.md' })), 'docs/a.md');
});

test('the browser descriptor validator agrees with the agent package validator', async () => {
  const browser = await load('artifact', 'artifact.ts', 'pi-artifacts');
  const agent = await import('@hachej/boring-agent/artifacts');
  const good = descriptor('abc', 2, { language: 'python', type: 'code', mediaType: 'text/plain' });
  const values = [good, descriptor('a', 1), undefined, null, 'x', [], {}, { ...good, schema: 'other' }, { ...good, id: '../x' }, { ...good, title: ' ' }, { ...good, type: 'pdf' }, { ...good, mediaType: 'nope' }, { ...good, language: 7 },
    { ...good, revision: '' }, { ...good, ordinal: 0 }, { ...good, ordinal: 1.5 }, { ...good, extra: 1 }, { ...good, target: { ...good.target, view: { kind: 'working' } } },
    { ...good, target: { ...good.target, view: { kind: 'working', viewId: 'v' } } }, { ...good, target: { resource: { providerId: 'x' }, view: { kind: 'published' } } }];
  for (const value of values) assert.deepEqual(browser.parseArtifact(value), agent.parseArtifact(value), JSON.stringify(value));
});

test('gated tool calls become approval cards that show the real arguments and the decision', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const { ApprovalCard, APPROVE, DENY, DENIED_PREFIX } = await load('approval-card', 'approval-card.tsx', 'pi-chat-approval');
  const agent = await import('@hachej/boring-agent/approval');
  assert.deepEqual([APPROVE, DENY, DENIED_PREFIX], [agent.APPROVE, agent.DENY, agent.DENIED_PREFIX], 'the card and requireApproval agree on the decision strings');
  assert.equal((await load('rows', 'rows.ts')).APPROVAL_DETAILS, agent.APPROVAL_DETAILS, 'and on where the stored summary travels');
  const args = { method: 'POST', url: '/fixture/api/notes', body: { title: 'Fictional note' } };
  const summaryKey = agent.APPROVAL_DETAILS;
  const text = 'Send POST /fixture/api/notes with {"title":"Fictional note"}';
  const details = { [summaryKey]: { summary: text } };
  const plainView = { entries: entries([user('add a note')], [assistant([call('1', 'api_request', args)])]), docs: {} };
  assert.deepEqual(derive(plainView, options('expert')).rows[1].parts.map(part => part.kind), ['tool'], 'a call that published no approval summary is an ordinary tool step');
  // While it waits, the call's running slot carries the summary requireApproval published before asking.
  const slot = { callId: '1', name: 'api_request', status: 'running', details };
  const pendingParts = derive({ ...plainView, docs: { 'pi.live': { tools: [slot] } } }, options('expert')).rows[1].parts;
  assert.deepEqual(pendingParts.map(part => part.kind), ['approval']);
  assert.equal(pendingParts[0].summary, text);
  const answers = [];
  const markup = parts => renderToStaticMarkup(createElement(ApprovalCard, { call: parts[0].call, result: parts[0].result, summary: parts[0].summary, answer: async (id, value) => { answers.push([id, value]); return { kind: 'answered' }; } }));
  const pending = markup(pendingParts);
  assert.match(pending, /data-state="pending"/);
  assert.match(pending, /data-testid="approval-approve"/);
  assert.match(pending, /data-testid="approval-deny"/);
  assert.match(pending, /data-testid="approval-summary"[^>]*>Send POST \/fixture\/api\/notes/);
  assert.match(pending, /<details[^>]*data-testid="approval-details"[^>]*>/, 'raw arguments are collapsible under the summary');
  assert.doesNotMatch(pending, /<details[^>]*\bopen\b/, 'collapsed by default');
  assert.match(pending, /Fictional note/, 'and still there');
  // Once settled, the result's details carry the summary and the decision requireApproval recorded.
  const done = (value, isError, decision) => derive({ entries: entries([user('add a note')], [assistant([call('1', 'api_request', args)])], [{ ...result('1', 'api_request', value, isError), details: { [summaryKey]: { summary: text, ...(decision ? { decision } : {}) } } }]), docs: {} }, options('expert')).rows[1].parts;
  const markupOf = parts => renderToStaticMarkup(createElement(ApprovalCard, { call: parts[0].call, result: parts[0].result, summary: parts[0].summary, decision: parts[0].decision, answer: async () => ({ kind: 'answered' }) }));
  const denied = done(`${DENIED_PREFIX} api_request was not run and nothing was changed.`, true, 'denied');
  assert.deepEqual(denied.map(part => part.kind), ['tool', 'approval'], 'the call stays a step of the activity block next to its card');
  assert.match(markupOf(denied.filter(part => part.kind === 'approval')), /data-state="denied"/);
  assert.doesNotMatch(markupOf(denied.filter(part => part.kind === 'approval')), /approval-approve/);
  const approved = done('created note 4', false, 'approved');
  assert.match(markupOf(approved.filter(part => part.kind === 'approval')), /data-state="approved"/);
  const failedAfterApproval = done('HTTP 500', true, 'approved');
  assert.match(markupOf(failedAfterApproval.filter(part => part.kind === 'approval')), /data-state="approved"/, 'approved, then the tool itself failed: still approved');
  // Stopped while it waited: no decision was recorded, so the card must not claim the call was approved.
  const stopped = done('Tool call aborted', true);
  const stoppedCard = markupOf(stopped.filter(part => part.kind === 'approval'));
  assert.match(stoppedCard, /data-state="cancelled"/);
  assert.match(stoppedCard, /Not decided: the run was stopped/);
  assert.doesNotMatch(stoppedCard, /approval-approve|>Approved</);
});

test('delegate calls become sub-agent cards that read DelegateDetails, live and settled', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const { RowView } = await load('subagent-message', 'message.tsx');
  const { SubagentCard, parseDelegateDetails, DELEGATE_DETAILS_KIND, subagentCard } = await load('subagent-card', 'subagent-card.tsx', 'pi-chat-subagent');
  // The card is the pi-chat-subagent item, plugged in as `cards.subagent`; without it a delegate call stays an ordinary tool step.
  const withCard = mode => ({ ...options(mode), subagent: subagentCard });
  const agents = await import('@hachej/boring-agent/agents');
  assert.equal(DELEGATE_DETAILS_KIND, agents.DELEGATE_DETAILS_KIND, 'the card and the delegate tool agree on the details kind');
  const running = { kind: agents.DELEGATE_DETAILS_KIND, version: 1, agent: 'researcher', conversationId: 14, status: 'running', startedAt: 1_000, durationMs: 1_500, toolCalls: 2, tokens: { input: 1_234, output: 56 } };
  const args = { agent: 'researcher', task: 'Summarise the fictional notes' };
  const view = { entries: entries([user('look it up')], [assistant([call('1', 'delegate', args)])]), docs: {} };
  assert.deepEqual(derive(view, withCard('expert')).rows[1].parts.map(part => part.kind), ['tool'], 'a call without delegate details is an ordinary tool step');
  // While the child runs, the call's live slot carries the details the delegate tool publishes through api.details.
  const liveView = { ...view, docs: { 'pi.live': { tools: [{ callId: '1', name: 'delegate', status: 'running', details: running }] } } };
  assert.deepEqual(derive(liveView, options('expert')).rows[1].parts.map(part => part.kind), ['tool'], 'without the pi-chat-subagent item the call is an ordinary tool step');
  const live = derive(liveView, withCard('natural')).rows[1].parts;
  assert.deepEqual(live.map(part => part.kind), ['subagent'], 'shown to every reader, natural mode included');
  assert.match(renderToStaticMarkup(live[0].content), /data-testid="subagent-card"[^>]*data-state="running"/, 'the part carries the item\'s card');
  const liveDetails = parseDelegateDetails(running);
  assert.equal(liveDetails.status, 'running');
  const card = details => renderToStaticMarkup(createElement(SubagentCard, { details, now: () => 4_000 }));
  const runningCard = card(liveDetails);
  assert.match(runningCard, /data-testid="subagent-card"[^>]*data-state="running"/);
  assert.match(runningCard, /data-conversation-id="14"/);
  assert.match(runningCard, /data-testid="subagent-spinner"/);
  assert.match(runningCard, /data-testid="subagent-status"[^>]*aria-label="Running"/, 'the status is an icon with an accessible name, no badge text');
  assert.doesNotMatch(runningCard, /data-slot="badge"/);
  assert.match(runningCard, /data-testid="subagent-time"[^>]*>.*3 s</, 'the time ticks from startedAt while it runs');
  assert.match(runningCard, /data-testid="subagent-tool-calls"[^>]*data-count="2"/);
  assert.match(runningCard, /aria-label="1234 tokens in, 56 tokens out"/);
  assert.match(runningCard, /1\.2k/);
  assert.match(runningCard, /data-testid="subagent-conversation"[^>]*>#14</);
  const opened = [];
  assert.match(renderToStaticMarkup(createElement(SubagentCard, { details: liveDetails, onOpen: id => opened.push(id) })), /<button[^>]*data-testid="subagent-open"[^>]*aria-label="Open conversation 14"/, 'a host can link the child conversation');
  // Settled: the result's details carry the finished value.
  const settled = (details, text, isError = false) => derive({ entries: entries([user('look it up')], [assistant([call('1', 'delegate', args)])], [{ ...result('1', 'delegate', text, isError), timestamp: 9_000, details }]), docs: {} }, withCard('expert')).rows[1].parts;
  const settledDetails = (details, text, isError = false) => parseDelegateDetails(details, { ...result('1', 'delegate', text, isError), timestamp: 9_000 });
  const done = settled({ ...running, status: 'done', durationMs: 7_000, toolCalls: 3 }, 'The fictional answer.');
  assert.deepEqual(done.map(part => part.kind), ['tool', 'subagent'], 'expert keeps the call as a step of the activity block next to its card');
  assert.match(renderToStaticMarkup(done[1].content), /data-testid="subagent-card"[^>]*data-state="done"/);
  const doneCard = card(settledDetails({ ...running, status: 'done', durationMs: 7_000, toolCalls: 3 }, 'The fictional answer.'));
  assert.match(doneCard, /data-state="done"/);
  assert.match(doneCard, /data-testid="subagent-time"[^>]*>.*7 s</);
  assert.match(doneCard, /data-count="3"/);
  assert.doesNotMatch(doneCard, /subagent-spinner|subagent-error/);
  const error = 'The researcher agent did not answer: model_error (Fictional provider refused the request)';
  const failedCard = card(settledDetails({ ...running, status: 'failed', error }, error, true));
  assert.match(failedCard, /data-state="failed"/);
  assert.match(failedCard, /data-testid="subagent-error"[^]*Fictional provider refused the request/);
  // A stopped delegate call: Pi writes the aborted result from the last running details, which the card reads as cancelled.
  assert.match(renderToStaticMarkup(settled(running, 'Tool call aborted', true)[1].content), /data-state="cancelled"/);
  const stopped = settledDetails(running, 'Tool call aborted', true);
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.durationMs, 8_000, 'up to the result');
  assert.match(card(stopped), /data-state="cancelled"/);
  assert.doesNotMatch(card(stopped), /subagent-spinner/);
  for (const value of [undefined, null, 'x', { ...running, version: 2 }, { ...running, kind: 'other' }, { ...running, toolCalls: -1 }, { ...running, status: 'odd' }, { ...running, tokens: null }]) assert.equal(parseDelegateDetails(value), undefined, JSON.stringify(value));
  // The transcript renders the card.
  const html = renderToStaticMarkup(createElement(RowView, { row: { key: 'reply', type: 'assistant', parts: live, text: '', streaming: true, active: true }, context: { developer: false } }));
  assert.match(html, /data-testid="subagent-card"/);
});

test('the browser mention parser agrees with the agent package mention resolver', async () => {
  const { pieces } = await load('config', 'config.ts');
  const { mentionedPaths } = await import('@hachej/boring-agent/mentions');
  const texts = ['', 'no mention', '@a.md', 'see @docs/a.md, and @b/c.txt.', 'mail me@x.com @ok', '(@paren) @q? @"quoted"', '@a @a @b', 'line\n@next\t@tab', '@', '@.', '@a/b!', 'x@y @z)', '/skill @file.md',
    '@"docs/Meeting notes.md" and @docs/plan.md.', '@"say \\"hi\\".md" @"a\\\\ b" @"unterminated', '@"" @"  "x', '@"a b"c @"tail'];
  for (const text of texts) {
    const browser = [...new Set(pieces(text, { mentions: true, skills: [] }).filter(piece => piece.kind === 'mention').map(piece => piece.value))];
    assert.deepEqual(browser, mentionedPaths(text), JSON.stringify(text));
  }
});

test('a mention with whitespace or a quote is written quoted, and parses, chips and removes as one token', async () => {
  const { pieces, mentionToken, hasMention, removeMention, mentionTrigger } = await load('config', 'config.ts');
  assert.equal(mentionToken('docs/plan.md'), '@docs/plan.md', 'a bare path is unchanged');
  assert.equal(mentionToken('docs/Meeting notes.md'), '@"docs/Meeting notes.md"');
  assert.equal(mentionToken('say "hi".md'), '@"say \\"hi\\".md"');
  const text = `see ${mentionToken('docs/Meeting notes.md')} and @docs/plan.md, ok`;
  const parsed = pieces(text, { mentions: true, skills: [] });
  assert.deepEqual(parsed.filter(piece => piece.kind === 'mention').map(piece => [piece.value, piece.text]), [['docs/Meeting notes.md', '@"docs/Meeting notes.md"'], ['docs/plan.md', '@docs/plan.md']]);
  assert.equal(hasMention(text, 'docs/Meeting notes.md'), true);
  assert.equal(hasMention(text, 'docs/Meeting'), false, 'a prefix of a path is not its mention');
  assert.equal(removeMention(text, 'docs/Meeting notes.md'), 'see and @docs/plan.md, ok');
  const quoted = 'x @"say \\"hi\\".md" y';
  assert.equal(pieces(quoted, { mentions: true, skills: [] }).find(piece => piece.kind === 'mention').value, 'say "hi".md');
  assert.equal(removeMention(quoted, 'say "hi".md'), 'x y');
  assert.deepEqual(mentionTrigger('open @"Meet', 11), { query: 'Meet', start: 5, end: 11 }, 'a typed opening quote is not part of the search');
});

test('reused call IDs keep each invocation result, question, key and orphan failure distinct', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const view = { entries: entries([user('go')],
    [assistant([call('same', 'read', { turn: 'first' })])], [result('same', 'read', 'first result')],
    [assistant([call('same', 'read', { turn: 'second' })])], [result('same', 'read', 'second result')],
    [result('same', 'read', 'unmatched failure', true)],
    [assistant([call('same', 'ask_user', { question: 'New question' })])]), docs: {} };
  const derived = derive(view, options('developer'));
  const parts = derived.rows.flatMap(row => row.type === 'assistant' ? row.parts : []);
  assert.deepEqual(parts.filter(part => part.kind === 'tool').map(part => [part.entry.call.arguments.turn, part.entry.result.content[0].text]),
    [['first', 'first result'], ['second', 'second result']]);
  assert.equal(parts.find(part => part.kind === 'question').result, undefined);
  assert.equal(parts.find(part => part.kind === 'question').questionId, JSON.stringify([7, 'same']));
  assert.equal(new Set(parts.map(part => part.key)).size, parts.length);
  assert.deepEqual(derived.rows.filter(row => row.type === 'orphan-result').map(row => row.message.content[0].text), ['unmatched failure']);
  const pinned = derive(view, { ...options('developer'), renderTool: (_call, result) => ({ required: true, content: result?.content[0].text }) }).pinned;
  assert.deepEqual(pinned.map(card => card.content), ['first result', 'second result']);
  assert.equal(new Set(pinned.map(card => card.key)).size, 2);
});

test('a live call with a reused ID has no earlier result and keeps its key when committed', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const earlier = entries([user('go')], [assistant([call('same', 'read')])], [result('same', 'read', 'earlier result')]);
  const next = call('same', 'read', { turn: 'new' });
  const live = derive({ entries: earlier, docs: { 'pi.live': { run: { taskId: 1 }, generation: { message: { content: [next] } } } } }, options('developer'));
  const livePart = live.rows.at(-1).parts.at(-1);
  assert.equal(livePart.entry.result, undefined);
  const committed = derive({ entries: [...earlier, { id: 4, kind: 'message', byTaskId: 1, model: [assistant([next])] }], docs: {} }, options('developer'));
  assert.equal(committed.rows.at(-1).parts.at(-1).key, livePart.key);
});


test('question controls submit the owning entry identity even when call IDs repeat', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  }
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { QuestionCard } = await load('question-card', 'question-card.tsx', 'pi-chat-question');
  const { derive } = await load('rows', 'rows.ts');
  const container = document.createElement('div'); document.body.append(container);
  const rootNode = createRoot(container);
  const sent = [];
  const answer = async (id, text) => { sent.push([id, text]); return { kind: 'answered' }; };
  try {
    const view = { entries: entries([assistant([call('same', 'ask_user', { question: 'First', options: ['A'] })])],
      [assistant([call('same', 'ask_user', { question: 'Second', options: ['B'] })])]), docs: {} };
    const parts = derive(view, options('expert')).rows[0].parts;
    await act(async () => rootNode.render(parts.map(part => createElement(QuestionCard, { ...part, answer }))));
    const choices = [...container.querySelectorAll('[data-testid="question-option"]')];
    assert.equal(choices.length, 2);
    await act(async () => choices[0].click());
    await act(async () => choices[1].click());
    assert.deepEqual(sent, [[JSON.stringify([1, 'same']), 'A'], [JSON.stringify([2, 'same']), 'B']]);
  } finally {
    await act(async () => rootNode.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});



test('pi-chat imports nothing of feedback: a host brings its card through sentContent', () => {
  const item = JSON.parse(readFileSync(`${root}registry.json`, 'utf8')).items.find(entry => entry.name === 'pi-chat');
  for (const file of item.files) assert.doesNotMatch(readFileSync(`${root}${file.path}`, 'utf8'), /['"]@hachej\/boring-feedback/, file.path);
  assert.ok(!item.dependencies.some(dependency => dependency.startsWith('@hachej/boring-feedback@')));
});

test('a host reply footer sees the model and timestamp of the last round of a settled reply, and only settled replies get one', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const { RowView } = await load('message', 'message.tsx');
  const rounds = [assistant([call('1', 'read')], { provider: 'openai-codex', model: 'gpt-6-sol', timestamp: 100 }), assistant([{ type: 'text', text: 'done' }], { provider: 'cloudflare-workers-ai', model: '@cf/moonshotai/kimi-k2.7-code', timestamp: 250 })];
  const view = { entries: entries([user('go')], [rounds[0]], [result('1', 'read', 'A')], [rounds[1]]), docs: {} };
  const row = derive(view, options('expert')).rows[1];
  assert.deepEqual(row.model, { provider: 'cloudflare-workers-ai', modelId: '@cf/moonshotai/kimi-k2.7-code' });
  assert.equal(row.timestamp, 250);
  const seen = [];
  const context = { developer: false, groupTool: undefined, commandMentions: undefined, onOpenImage: undefined, onCopy: undefined, pieces: undefined, answer: undefined, artifacts: undefined,
    replyFooter: reply => { seen.push(reply); return createElement('small', { 'data-testid': 'footer' }, `${reply.model.modelId} ${reply.timestamp}`); } };
  const html = renderToStaticMarkup(createElement(RowView, { row, context }));
  assert.match(html, /data-testid="footer">@cf\/moonshotai\/kimi-k2\.7-code 250</);
  assert.equal(seen[0].text, 'done');
  const streaming = renderToStaticMarkup(createElement(RowView, { row: { ...row, streaming: true }, context }));
  assert.ok(!streaming.includes('data-testid="footer"'));
  assert.ok(!renderToStaticMarkup(createElement(RowView, { row, context: { ...context, replyFooter: undefined } })).includes('footer'));
});

const footerContext = seen => ({ developer: false, groupTool: undefined, commandMentions: undefined, onOpenImage: undefined, onCopy: undefined, pieces: undefined, answer: undefined, artifacts: undefined,
  replyFooter: reply => { seen.push(reply); return createElement('small', { 'data-testid': 'footer' }, `${reply.model?.modelId} ${reply.durationMs}`); } });

test('a reply footer waits for the whole turn: no footer while a tool runs or a retry waits, and the answer sums the native rounds’ durationMs', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const { RowView } = await load('message', 'message.tsx');
  const rounds = [assistant([{ type: 'text', text: 'let me look' }, call('1', 'read')], { model: 'a', timestamp: 100, durationMs: 700 }), assistant([{ type: 'text', text: 'done' }], { model: 'b', timestamp: 250, durationMs: 1200 })];
  const settledView = { entries: entries([user('go')], [rounds[0]], [result('1', 'read', 'A')], [rounds[1]]), docs: {} };
  const html = (view, seen = []) => { const row = derive(view, options('expert')).rows[1]; return { row, seen, html: renderToStaticMarkup(createElement(RowView, { row, context: footerContext(seen) })) }; };
  // A tool round: the run is active, nothing is streaming.
  const tool = html({ entries: entries([user('go')], [rounds[0]]), docs: { 'pi.live': { run: { taskId: 1 } } } });
  assert.equal(tool.row.active, true); assert.equal(tool.row.streaming, false);
  assert.ok(!tool.html.includes('data-testid="footer"'));
  // Retry backoff: the run is active, the generation holds a retry and no message.
  const retrying = html({ entries: entries([user('go')], [rounds[0]]), docs: { 'pi.live': { run: { taskId: 1 }, generation: { retry: { attempt: 1 } } } } });
  assert.equal(retrying.row.active, true);
  assert.ok(!retrying.html.includes('data-testid="footer"'));
  // Finished: the footer shows the last model and the sum of Pi’s round durations.
  const done = html(settledView);
  assert.match(done.html, /data-testid="footer">b 1900</);
  assert.equal(done.seen[0].durationMs, 1900);
  // A message Pi wrote before it recorded durations has none.
  const legacy = derive({ entries: entries([user('go')], [assistant([{ type: 'text', text: 'ok' }])]), docs: {} }, options('expert')).rows[1];
  assert.ok(!('durationMs' in legacy));
});

test('an empty final round still names the model, time and duration of the round that ended the reply', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const view = { entries: entries([user('go')], [assistant([{ type: 'text', text: 'checking' }, call('1', 'read')], { model: 'a', timestamp: 100, durationMs: 5 })], [result('1', 'read', 'A')], [assistant([], { model: 'b', timestamp: 300, durationMs: 9 })]), docs: {} };
  const rows = derive(view, options('expert')).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].model, { provider: 'x', modelId: 'b' });
  assert.equal(rows[1].timestamp, 300); assert.equal(rows[1].durationMs, 14);
  assert.equal(rows[1].entryId, '4');
  assert.equal(rows[1].text, 'checking');
});

test('earlier records use normal message components and footer without reviving host actions', async () => {
  const { RowView } = await load('message', 'message.tsx');
  const { derive } = await load('rows', 'rows.ts');
  const view = { entries: entries([user('go')], [assistant([{ type: 'text', text: 'old answer' }], { model: 'old', timestamp: 5, durationMs: 42 })]), docs: {} };
  const rows = derive(view, options('expert')).rows.map(row => ({ ...row, historical: true }));
  const seen = [];
  const context = { ...footerContext(seen), messageActions() { throw new Error('Archived messages must not register current host actions'); }, onFork() { throw new Error('Archived fork action'); } };
  const html = renderToStaticMarkup(createElement('div', null, rows.map(row => createElement(RowView, { key: row.key, row, context }))));
  assert.match(html, /data-testid="user-text"/);
  assert.match(html, /data-testid="footer">old 42</);
  assert.equal(seen.length, 1); assert.equal(seen[0].text, 'old answer'); assert.equal(seen[0].timestamp, 5);
  assert.doesNotMatch(html, /fork-reply|reply-action/);
  assert.ok(!renderToStaticMarkup(createElement(RowView, { row: rows[1], context: { ...context, replyFooter: undefined } })).includes('footer'));
});


test('the expanded ambient window shows the host reply footer under a settled reply', async () => {
  const { AmbientChat } = await load('ambient', 'ambient.tsx', 'pi-ambient');
  const view = { entries: entries([user('go')], [assistant([{ type: 'text', text: 'all done' }], { model: 'amb', timestamp: 9, durationMs: 77 })]), docs: {} };
  const snapshot = { identity: {}, conversationId: 'c1', connection: { kind: 'connected' }, view, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' },
    send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const seen = [];
  const html = renderToStaticMarkup(createElement(AmbientChat, { controller, state: 'expanded', replyFooter: reply => { seen.push(reply); return createElement('small', { 'data-testid': 'footer' }, `${reply.model.modelId} ${reply.durationMs}`); } }));
  assert.match(html, /data-testid="footer">amb 77</);
  assert.equal(seen[0].text, 'all done');
  assert.ok(!renderToStaticMarkup(createElement(AmbientChat, { controller, state: 'expanded' })).includes('data-testid="footer"'));
});

test('audio extensions use the audio kind without changing ordinary file classification', async () => {
  const { fileKind, isVoicePath } = await load('voice-config', 'config.ts');
  for (const extension of ['webm', 'ogg', 'm4a', 'mp4', 'mp3', 'wav']) assert.equal(fileKind(`uploads/voice-20261020-101500.${extension}`), 'audio');
  assert.equal(isVoicePath('uploads/voice-20261020-101500.webm'), true);
  assert.equal(isVoicePath('uploads/song.mp3'), false);
  assert.equal(fileKind('uploads/fictional.pdf'), 'pdf');
});

test('a user target context renders as a chip, leaving only speech in the message bubble', async () => {
  const { RowView } = await load('target-chip', 'message.tsx');
  const row = { key: 'target', type: 'user', message: { role: 'user', content: '<target>{"meal":"m-42","slot":"lunch"}</target>\n\nremplace le riz par 150 g de pâtes', timestamp: 1 } };
  const html = renderToStaticMarkup(createElement(RowView, { row, context: {} }));
  assert.match(html, /data-testid="message-target"/);
  assert.match(html, /remplace le riz par 150 g de pâtes/);
  assert.ok(!html.includes('&lt;target&gt;'), 'the context is not dumped into the text bubble');
});

test('the "Take a photo" item shows only for attachments that admit images on a coarse pointer', async t => {
  const { Window } = await import('happy-dom');
  const { act } = await import('react'); const { createRoot } = await import('react-dom/client');
  // The menu opens through pointer sequences happy-dom does not run; the test swaps the dropdown for one that always shows its items.
  const stub = `import { createElement as h } from 'react';
    export const DropdownMenu = ({ children }) => h('div', null, children);
    export const DropdownMenuTrigger = ({ children, render, ...props }) => h('button', props, children);
    export const DropdownMenuContent = ({ children }) => h('div', { role: 'menu' }, children);
    export const DropdownMenuItem = ({ children, onClick, ...props }) => h('div', { role: 'menuitem', onClick, ...props }, children);`;
  await build({ entryPoints: [`${root}registry/pi-chat/composer.tsx`], outfile: `${out}/composer-menu-stub.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'stub-menu', setup(builder) { builder.onResolve({ filter: /components\/ui\/dropdown-menu$/ }, () => ({ path: 'stub-menu', namespace: 'stub' })); builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js', resolveDir: root })); } }] });
  const { Composer, acceptsPhotos } = await import(pathToFileURL(`${out}/composer-menu-stub.mjs`).href);
  assert.deepEqual(['', 'image/*', 'image/png, image/jpeg', '.jpg', '*/*'].map(acceptsPhotos), [true, true, true, true, true]);
  assert.deepEqual(['application/pdf', 'image/png,.pdf', 'text/*'].map(acceptsPhotos), [false, false, false]);

  const noop = () => {};
  const base = { text: '', onText: noop, attachments: [], onRemoveAttachment: noop, working: false, sendBlocked: false, disabled: false, stopRequested: false,
    onSend: noop, onStop: noop, uploading: false, canAttach: true, fileAccept: 'image/*', onPickFiles: noop, textareaRef: { current: null }, camera: () => null };
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'MutationObserver', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT'];
  const showsItem = async (props, coarse) => {
    const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
    const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const matchMedia = query => ({ matches: coarse && query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} });
    for (const name of names) {
      const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'matchMedia' ? matchMedia : window[name];
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) && name !== 'matchMedia' ? value.bind(window) : value });
    }
    const container = window.document.createElement('div'); window.document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Composer, { ...base, ...props })));
      assert.ok(window.document.querySelector('[data-testid=composer-plus]'), 'the composer rendered its menu');
      return window.document.querySelector('[data-testid=composer-take-photo]') !== null;
    } finally {
      await act(async () => root.unmount()); await window.happyDOM.close();
      for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    }
  };
  assert.equal(await showsItem({}, true), true, 'coarse pointer, images admitted');
  assert.equal(await showsItem({ fileAccept: '' }, true), true, 'an empty accept admits everything');
  assert.equal(await showsItem({}, false), false, 'a fine pointer has no camera item');
  assert.equal(await showsItem({ fileAccept: 'application/pdf' }, true), false, 'a PDF-only accept');
  assert.equal(await showsItem({ canAttach: false, onCommands: undefined, slash: { commands: [{ name: 'help', description: 'Fictional help' }], Picker: () => null } }, true), false, 'without attachments');
  assert.equal(await showsItem({ camera: undefined }, true), false, 'without the pi-chat-attachments camera');
  t.diagnostic('menu item gating checked in six states');
});

test('the camera words exist in English and French, and the English composer baseline markup has no camera', async () => {
  const { defaultChatLabels, defaultChatIcons } = await load('labels', 'labels.ts');
  const { frChatLabels } = await load('labels-fr', 'labels-fr.ts').then(module => ({ frChatLabels: Object.values(module).find(value => value && typeof value === 'object' && 'attachFiles' in value) }));
  for (const key of ['takePhoto', 'cameraShoot', 'cameraClose', 'cameraUnavailable', 'cameraFallback']) {
    assert.equal(typeof defaultChatLabels[key], 'string', `${key} in English`);
    assert.equal(typeof frChatLabels[key], 'string', `${key} in French`);
    assert.notEqual(frChatLabels[key], defaultChatLabels[key], `${key} is translated`);
  }
  assert.equal(defaultChatLabels.takePhoto, 'Take a photo');
  assert.equal(frChatLabels.takePhoto, 'Prendre une photo');
  assert.equal(defaultChatLabels.cameraFallback, "Use the phone's camera");
  assert.equal(frChatLabels.cameraFallback, 'Utiliser l’appareil photo du téléphone');
  assert.ok(defaultChatIcons.camera, 'a camera icon');
  const { Composer } = await load('composer', 'composer.tsx');
  const html = renderToStaticMarkup(createElement(Composer, { text: '', onText() {}, attachments: [], onRemoveAttachment() {}, working: false, sendBlocked: false, disabled: false, stopRequested: false, onSend() {}, onStop() {}, uploading: false, canAttach: true, fileAccept: 'image/*', onPickFiles() {}, textareaRef: { current: null } }));
  assert.doesNotMatch(html, /take-photo|camera-sheet/, 'server markup is unchanged: the item needs a coarse pointer and an open menu');
});
