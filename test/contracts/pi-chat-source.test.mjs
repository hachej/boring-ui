import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Compiles the pi-chat registry source as a consumer would and exercises its pure parts: safe Markdown and the row model.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/pi-chat-test`;
mkdirSync(out, { recursive: true });
async function load(name, entry) {
  await build({ entryPoints: [`${root}registry/pi-chat/${entry}`], outfile: `${out}/${name}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(`${out}/${name}.mjs`).href);
}
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

test('Markdown keeps model HTML inert and refuses unsafe link targets', async () => {
  const { Markdown } = await load('markdown', 'markdown.tsx');
  const html = renderToStaticMarkup(createElement(Markdown, { text: '<img src=x onerror=alert(1)> <script>alert(1)</script>\n\n[a](javascript:alert(1)) [b](data:text/html,x) [c](https://example.com/p) [d](//evil.test) ![i](https://evil.test/x.png)' }));
  assert.ok(!/<img|<script|onerror=/.test(html.replace(/&lt;[^]*?&gt;/g, '')), html);
  assert.ok(!/href="javascript:|href="data:|href="\/\//.test(html), html);
  assert.match(html, /href="https:\/\/example\.com\/p"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.ok(!/<img/.test(html), 'images are shown as text, never fetched');
});

test('Markdown renders fenced code as a labelled, copyable block', async () => {
  const { Markdown } = await load('markdown', 'markdown.tsx');
  const html = renderToStaticMarkup(createElement(Markdown, { text: '```python\nprint("hi")\n```' }));
  assert.match(html, /data-testid="code-language"[^>]*>python</);
  assert.match(html, /aria-label="Copy code"/);
  assert.match(html, /print\(&quot;hi&quot;\)/);
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
  const withArtifacts = mode => ({ ...options(mode), artifacts: {} });
  const view = { entries: entries([user('write')],
    [assistant([call('1', 'present', { path: 'docs/a.md' }), call('2', 'present', { path: 'docs/b.md' })])], [presentResult('1', presented('a', 'a-1')), presentResult('2', presented('b', 'b-1'))],
    [assistant([call('3', 'present', { path: 'docs/a.md' }), call('4', 'present', { path: './docs/a.md' }), call('5', 'read', { path: 'docs/a.md' })])],
    [presentResult('3', presented('a', 'a-2')), presentResult('4', presented('a', 'a-3')), result('5', 'read', 'x')],
    [assistant([{ type: 'text', text: 'Done.' }])]), docs: {} };
  for (const mode of ['expert', 'developer']) {
    const cards = derive(view, withArtifacts(mode)).rows[1].parts.filter(part => part.kind === 'artifact');
    assert.deepEqual(cards.map(card => [card.artifact.target.resource.path, card.artifact.revision, card.state]), [['docs/b.md', 'b-1', 'ready'], ['docs/a.md', 'a-3', 'ready']], mode);
  }
  // Cards sit outside the activity block, at the place of their step.
  const parts = derive(view, withArtifacts('expert')).rows[1].parts;
  assert.deepEqual(segments(parts, undefined).map(item => item.kind === 'part' ? item.part.kind : item.kind), ['artifact', 'artifact', 'activity', 'text']);
  // Without the option nothing changes.
  assert.ok(!derive(view, options('developer')).rows[1].parts.some(part => part.kind === 'artifact'));
  // A running present shows an in-progress card named after the file; presenting a shown file again replaces its card.
  const running = { entries: entries([user('write')], [assistant([call('1', 'present', { path: 'docs/a.md' }), call('3', 'present', { path: 'docs/b.md' })])], [presentResult('1', presented('a', 'a-1'))]), docs: { 'pi.live': { run: { taskId: 1 } } } };
  const live = derive(running, withArtifacts('expert')).rows[1].parts.filter(part => part.kind === 'artifact');
  assert.deepEqual(live.map(card => [card.state, card.artifact?.revision, card.title]), [['ready', 'a-1', 'a.md'], ['presenting', undefined, 'b.md']]);
  const replaced = { ...running, entries: entries([user('write')], [assistant([call('1', 'present', { path: 'docs/a.md' })])], [presentResult('1', presented('a', 'a-1'))], [assistant([call('2', 'present', { path: 'docs/a.md' })])]) };
  const second = derive(replaced, withArtifacts('expert')).rows[1].parts.filter(part => part.kind === 'artifact');
  assert.deepEqual(second.map(card => [card.state, card.title]), [['presenting', 'a.md']]);
  // A failed call and a call that stopped show no card, only the ordinary step.
  const failed = { entries: entries([user('write')], [assistant([call('1', 'present', { path: 'docs/a.md' })])], [result('1', 'present', 'denied', true)]), docs: {} };
  assert.deepEqual(derive(failed, withArtifacts('expert')).rows[1].parts.map(part => part.kind), ['tool']);
  const stopped = { entries: entries([user('write')], [assistant([call('1', 'present', { path: 'docs/a.md' })])]), docs: {} };
  assert.deepEqual(derive(stopped, withArtifacts('expert')).rows[1].parts.map(part => part.kind), ['tool']);
  // A host detector maps a result that carries no descriptor (the step stays in the activity block next to its card); a faulty or malformed one is ignored.
  const saved = { entries: entries([user('save')], [assistant([call('1', 'save_note', {})])], [result('1', 'save_note', '{"kind":"committed"}')]), docs: {} };
  assert.deepEqual(derive(saved, { ...options('expert'), artifacts: { detect: () => descriptor('doc', 4) } }).rows[1].parts.map(part => part.kind), ['tool', 'artifact']);
  assert.deepEqual(derive(saved, { ...options('expert'), artifacts: { detect: () => ({ nope: 1 }) } }).rows[1].parts.map(part => part.kind), ['tool']);
  assert.deepEqual(derive(saved, { ...options('expert'), artifacts: { detect: () => { throw new Error('boom'); } } }).rows[1].parts.map(part => part.kind), ['tool']);
});

test('collectArtifacts lists every version a conversation produced', async () => {
  const { collectArtifacts } = await load('artifact', 'artifact.ts');
  const view = { entries: entries([user('x')], [assistant([call('1', 'present', { path: 'docs/a.md' }), call('2', 'present', { path: 'docs/a.md' }), call('3', 'present', { path: 'docs/c.md' }), call('4', 'bash', {})])],
    [presentResult('1', presented('a', 'a-1')), presentResult('2', presented('a', 'a-2')), result('3', 'present', JSON.stringify({ kind: 'presented', artifact: 'not a descriptor' })),
      // A valid descriptor in the text of any other tool (here `cat card.json`) must not become a card.
      result('4', 'bash', JSON.stringify({ kind: 'presented', artifact: presented('forged', 'f-1') }))]), docs: {} };
  assert.deepEqual(collectArtifacts(view).map(item => [item.target.resource.path, item.revision]), [['docs/a.md', 'a-1'], ['docs/a.md', 'a-2']]);
});

test('the browser descriptor validator agrees with the agent package validator', async () => {
  const browser = await load('artifact', 'artifact.ts');
  const agent = await import('@hachej/boring-agent/artifacts');
  const good = descriptor('abc', 2, { language: 'python', type: 'code', mediaType: 'text/plain' });
  const values = [good, descriptor('a', 1), undefined, null, 'x', [], {}, { ...good, schema: 'other' }, { ...good, id: '../x' }, { ...good, title: ' ' }, { ...good, type: 'pdf' }, { ...good, mediaType: 'nope' }, { ...good, language: 7 },
    { ...good, revision: '' }, { ...good, ordinal: 0 }, { ...good, ordinal: 1.5 }, { ...good, extra: 1 }, { ...good, target: { ...good.target, view: { kind: 'working' } } },
    { ...good, target: { ...good.target, view: { kind: 'working', viewId: 'v' } } }, { ...good, target: { resource: { providerId: 'x' }, view: { kind: 'published' } } }];
  for (const value of values) assert.deepEqual(browser.parseArtifact(value), agent.parseArtifact(value), JSON.stringify(value));
});

test('gated tool calls become approval cards that show the real arguments and the decision', async () => {
  const { derive } = await load('rows', 'rows.ts');
  const { ApprovalCard, APPROVE, DENY, DENIED_PREFIX } = await load('approval-card', 'approval-card.tsx');
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

test('provider setup lists any registered provider with its models, key state, sign-in and gateway note', async () => {
  const { ProviderSetup } = await load('provider-setup', '../provider-setup/provider-setup.tsx');
  const providers = [
    { id: 'alpha', name: 'Alpha', models: [{ id: 'a-1' }, { id: 'a-2', name: 'Alpha Two' }], auth: ['api_key'], configured: true },
    { id: 'beta', name: 'Beta subscription', models: [{ id: 'b-1' }], auth: ['oauth'], configured: false, needsGateway: true, loginLabel: 'Sign in with Beta' },
    { id: 'gamma', name: 'Gamma', models: [], auth: ['api_key', 'oauth'], configured: false },
  ];
  const render = (value, extra = {}) => renderToStaticMarkup(createElement(ProviderSetup, { providers, value, onSave: async () => {}, onLogin: () => {}, defaultOpen: true, ...extra }));
  const alpha = render({ provider: 'alpha', modelId: 'a-2' });
  for (const name of ['Alpha', 'Beta subscription', 'Gamma']) assert.ok(alpha.includes(name), name);
  assert.match(alpha, /Alpha Two/);
  assert.match(alpha, /data-testid="key-saved"/);
  assert.match(alpha, /type="password"/);
  assert.doesNotMatch(alpha, /provider-login/);
  assert.doesNotMatch(alpha, /gateway-note/);
  const beta = render({ provider: 'beta', modelId: 'b-1' }, { loginState: { state: 'pending', userCode: 'ABCD-1234', verificationUri: 'https://login.example.invalid/device' } });
  assert.match(beta, /Sign in with Beta/);
  assert.match(beta, /ABCD-1234/);
  assert.match(beta, /https:\/\/login\.example\.invalid\/device/);
  assert.match(beta, /data-testid="gateway-note"/);
  assert.doesNotMatch(beta, /type="password"/);
  assert.doesNotMatch(render({ provider: 'beta', modelId: 'b-1' }, { onLogin: undefined }), /provider-login/);
  assert.doesNotMatch(render({ provider: 'alpha', modelId: 'a-1' }, { showGateway: false }), /gateway-input/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ProviderSetup, { providers, value: { provider: 'alpha', modelId: 'a-1' }, onSave: async () => {} })), /provider-setup-panel/, 'closed by default');
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
  const { QuestionCard } = await load('question-card', 'question-card.tsx');
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

test('feedback cards: list results and offers stay visible in expert mode; hovering or clicking an element line displays the host result honestly', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  }
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { derive, segments } = await load('rows', 'rows.ts');
  const { FeedbackCard, FeedbackMention, feedbackMentionId, feedbackRenderTool, feedbackResultView } = await load('feedback-card', 'feedback-card.tsx');
  const container = document.createElement('div'); document.body.append(container);
  const rootNode = createRoot(container);
  // Fictional reports only.
  const id = 'fb_7Q2mK9xRt4vW1cZp';
  const listed = { kind: 'available', action: 'list', protection: 'unprotected', cursor: null, items: [{ id, status: 'open', title: 'Make Save green', subject: 'host:app-page:northwind-console:%2Fsettings', created: '2026-10-05T12:00:00Z', age: '2 h', revision: 'r1', author: 'Ada',
    anchors: [{ index: 0, kind: 'app.element@1', fallback: 'the «Save» button', placement: 'checked in the page', signals: { source: 'src/settings/SaveBar.tsx:42' } }, { index: 1, kind: 'pdf.rect@7', fallback: 'page 3', placement: { kind: 'unsupported', evaluated: 'no resolution is installed for pdf.rect@7' } }] }] };
  const offered = { kind: 'offered', action: 'show', id, anchor: 0, note: 'This one?', fallback: 'the «Save» button', subject: 'host:app-page:northwind-console:%2Fsettings', message: 'Offered to the person.' };
  try {
    // Expert mode: list results and offers are inline cards; read stays a step; an ordinary custom card stays hidden.
    const view = { entries: entries([user('go')], [assistant([call('1', 'feedback', { action: 'list' }), call('2', 'feedback', { action: 'show', id }), call('3', 'feedback', { action: 'read', id })])],
      [result('1', 'feedback', JSON.stringify(listed))], [result('2', 'feedback', JSON.stringify(offered))], [result('3', 'feedback', JSON.stringify({ kind: 'available', action: 'read', id, revision: 'r1', report: '---' }))]), docs: {} };
    const renderTool = feedbackRenderTool({});
    const expert = derive(view, { ...options('expert'), renderTool }).rows[1];
    assert.deepEqual(expert.parts.map(part => [part.kind, Boolean(part.entry?.custom)]), [['tool', true], ['tool', true], ['tool', false]]);
    assert.deepEqual(segments(expert.parts, undefined).map(item => item.kind), ['part', 'part', 'activity']);
    const plain = derive(view, { ...options('expert'), renderTool: () => ({ content: 'ordinary' }) }).rows[1];
    assert.ok(plain.parts.every(part => !part.entry?.custom), 'non-inline custom tool cards keep their expert-mode behaviour');
    assert.equal(feedbackResultView(call('9', 'feedback', {}), result('9', 'feedback', JSON.stringify(offered), true)), undefined, 'a failed call has no card');
    assert.equal(feedbackResultView(call('9', 'other', {}), result('9', 'other', JSON.stringify(offered))), undefined);
    assert.equal(feedbackResultView(call('9', 'feedback', {}), result('9', 'feedback', JSON.stringify({ ...offered, id: 'fb_0000000000000000' }))), undefined, 'ids are checked by @hachej/boring-feedback/format');
    assert.deepEqual(feedbackResultView(call('9', 'feedback', {}), result('9', 'feedback', JSON.stringify({ kind: 'denied', action: 'show', id, reason: 'Reading this feedback is not authorized' }))), { kind: 'refused', outcome: 'denied', reason: 'Reading this feedback is not authorized' });

    // The list card.
    await act(async () => rootNode.render(createElement(FeedbackCard, { view: feedbackResultView(call('1', 'feedback', {}), result('1', 'feedback', JSON.stringify(listed))) })));
    assert.equal(container.querySelectorAll('[data-testid="feedback-item"]').length, 1);
    assert.deepEqual([...container.querySelectorAll('[data-testid="feedback-placement"]')].map(node => node.textContent), ['unsupported'], '"checked in the page" says nothing worth a badge');
    assert.ok(container.querySelector('[data-testid="feedback-unprotected"]'), 'an unprotected store is stated');
    assert.equal(container.querySelector('[data-testid="feedback-fallback"]').textContent, '«Save» button', 'the readable name, without the article');
    assert.equal(container.querySelector('[data-testid="feedback-source"]').textContent, 'SaveBar.tsx:42', 'the element line names its file:line');
    assert.equal(container.querySelector('[data-testid="feedback-source"]').getAttribute('title'), 'src/settings/SaveBar.tsx:42', 'the full path only in the tooltip');
    assert.doesNotMatch(container.textContent, /checked in the page|src\/settings/);
    assert.deepEqual([...container.querySelectorAll('[data-testid="feedback-element"]')].map(node => node.tagName), ['SPAN', 'SPAN'], 'without the page, element lines are plain text');
    const listRequests = [];
    await act(async () => rootNode.render(createElement(FeedbackCard, { key: 'list-in-page', view: feedbackResultView(call('1', 'feedback', {}), result('1', 'feedback', JSON.stringify(listed))), onShowFeedback: async request => { listRequests.push(request); return { kind: 'applied' }; } })));
    assert.deepEqual([...container.querySelectorAll('[data-testid="feedback-element"]')].map(node => node.tagName), ['BUTTON', 'SPAN'], 'only a kind this page places is hoverable');
    await act(async () => container.querySelector('[data-testid="feedback-element"]').click());
    assert.deepEqual(listRequests, [{ id, anchor: 0, intent: 'click' }]);
    assert.equal(container.querySelector('[data-testid="feedback-outcome"]').dataset.outcome, 'applied');
    assert.equal(container.querySelector('[data-testid="feedback-outcome"]').textContent, 'shown in the page', 'a small ✓ (its text for screen readers)');

    // Readable element lines, from the demo's real fallbacks: name semibold, basename muted, path once (tooltip), no article or › path.
    const readable = { ...listed, items: [{ ...listed.items[0], anchors: [
      { index: 0, kind: 'app.element@1', fallback: 'the «Save profile» button (SettingsPage.jsx:65)', placement: 'checked in the page', signals: { source: 'examples/feedback/settings/SettingsPage.jsx:65' } },
      { index: 1, kind: 'app.element@1', fallback: 'a masked list item in aside › ul (ActivityPanel.jsx:7)', placement: 'checked in the page', signals: { source: 'examples/feedback/settings/ActivityPanel.jsx:7' } },
      { index: 2, kind: 'app.element@1', fallback: 'the «Try email exports» button (SettingsPage.jsx:57)', placement: 'checked in the page', signals: { source: 'examples/feedback/settings/SettingsPage.jsx:57' } },
      { index: 3, kind: 'app.element@1', fallback: 'the «Try email exports» button (SettingsPage.jsx:30)', placement: 'checked in the page' }] }] };
    const cardOutcomes = { 0: { kind: 'applied', reason: 'Found where the report points.', detail: 'found' },
      1: { kind: 'unavailable', reason: 'It matches 3 places on this page; click to choose one.', detail: 'choose', matches: 3 },
      2: { kind: 'unavailable', reason: 'One place on this page may be it; click to confirm.', detail: 'choose', matches: 1 },
      3: { kind: 'stale', reason: 'Missing: Nothing on this page matches the «Try email exports» button (SettingsPage.jsx:30).', detail: 'missing' } };
    await act(async () => rootNode.render(createElement(FeedbackCard, { key: 'readable', view: feedbackResultView(call('1', 'feedback', {}), result('1', 'feedback', JSON.stringify(readable))), onShowFeedback: async request => cardOutcomes[request.anchor] })));
    const lines = () => [...container.querySelectorAll('[data-testid="feedback-element"]')];
    for (const line of lines()) await act(async () => line.click());
    assert.deepEqual(lines().map(line => [line.querySelector('[data-testid="feedback-fallback"]').textContent, line.querySelector('[data-testid="feedback-source"]')?.textContent, line.querySelector('[data-testid="feedback-outcome"]').textContent]), [
      ['«Save profile» button', 'SettingsPage.jsx:65', 'shown in the page'],
      ['masked list item', 'ActivityPanel.jsx:7', '3 matches · choose'],
      ['«Try email exports» button', 'SettingsPage.jsx:57', 'confirm'],
      ['«Try email exports» button', 'SettingsPage.jsx:30', 'not on this page'],
    ]);
    const cardText = container.querySelector('[data-testid="feedback-card"]').textContent;
    assert.doesNotMatch(cardText, /1 places|Ambiguous|ambiguous|Unavailable:|Stale:|Missing:|checked in the page|examples\/feedback|›|\(SettingsPage/, cardText);
    assert.equal(cardText.split('SettingsPage.jsx:65').length - 1, 1, 'the location is said once');
    assert.equal(lines()[3].querySelector('[data-testid="feedback-outcome"]').getAttribute('title'), cardOutcomes[3].reason, 'the host\'s full reason stays in the tooltip');

    // Outside the subject's page (no host callback): unavailable, open the application page; nothing claims a reveal.
    const offer = feedbackResultView(call('2', 'feedback', {}), result('2', 'feedback', JSON.stringify(offered)));
    await act(async () => rootNode.render(createElement(FeedbackCard, { view: offer })));
    let card = container.querySelector('[data-testid="feedback-card"]');
    assert.equal(card.getAttribute('data-outcome'), 'unavailable');
    assert.equal(container.querySelector('[data-testid="feedback-outcome"]').textContent, 'open the app page to see it');
    assert.match(container.querySelector('[data-testid="feedback-outcome"]').getAttribute('title'), /^Open the application page/);
    assert.equal(container.querySelector('[data-testid="feedback-element"]').tagName, 'SPAN', 'nothing to hover or press');
    assert.equal(container.querySelector('[data-testid="feedback-show"]'), null, 'there is no Show button any more');
    assert.doesNotMatch(container.textContent, /shown in the page/);

    // In the page: Show calls the host and displays exactly what it reported.
    const requests = [];
    const outcomes = [{ kind: 'stale', reason: 'the page changed since the report' }, { kind: 'applied' }, new Error('boom'), { kind: 'revealed' }];
    const onShowFeedback = async request => { requests.push(request); const next = outcomes.shift(); if (next instanceof Error) throw next; return next; };
    let hidden = 0;
    await act(async () => rootNode.render(createElement(FeedbackCard, { key: 'in-page', view: offer, onShowFeedback, onHideFeedback: () => { hidden++; } })));
    card = container.querySelector('[data-testid="feedback-card"]');
    assert.equal(card.getAttribute('data-outcome'), null, 'nothing is shown before the person hovers or clicks the element line');
    const expectations = [['stale', 'changed since', /the page changed since the report/], ['applied', 'shown in the page', /Shown in the page/], ['unavailable', 'can’t show it here', /The page could not show it/], ['unavailable', 'can’t show it here', /no recognised result/]];
    for (const [kind, words, reason] of expectations) {
      await act(async () => container.querySelector('[data-testid="feedback-element"]').click());
      assert.equal(container.querySelector('[data-testid="feedback-card"]').getAttribute('data-outcome'), kind);
      assert.equal(container.querySelector('[data-testid="feedback-outcome"]').textContent, words);
      assert.match(container.querySelector('[data-testid="feedback-outcome"]').getAttribute('title'), reason);
    }
    assert.deepEqual(requests[0], { id, anchor: 0, note: 'This one?', intent: 'click' });
    assert.equal(requests.length, 4);
    // Hover asks for a highlight only; leaving the line clears it.
    outcomes.push({ kind: 'unavailable', reason: 'It matches 2 places on this page; click to choose one.', detail: 'choose', matches: 2 });
    const line = container.querySelector('[data-testid="feedback-element"]');
    await act(async () => { line.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
    assert.equal(requests.at(-1).intent, 'hover');
    assert.equal(container.querySelector('[data-testid="feedback-outcome"]').textContent, '2 matches · choose');
    await act(async () => { line.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); });
    assert.equal(hidden, 1);

    // Mentions of a report.
    assert.equal(feedbackMentionId(`feedback/${id}.md`), id);
    assert.equal(feedbackMentionId(`${id}.md`), id);
    assert.equal(feedbackMentionId('notes/plan.md'), undefined);
    assert.equal(feedbackMentionId('feedback/fb_0000000000000000.md'), undefined);
    await act(async () => rootNode.render(createElement(FeedbackMention, { path: `feedback/${id}.md`, id })));
    assert.equal(container.querySelector('[data-testid="feedback-mention"]').textContent, id);
  } finally {
    await act(async () => rootNode.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});

test('a sent @mention of a feedback report renders as a feedback chip; other mentions are unchanged', async () => {
  const { RowView } = await load('message', 'message.tsx');
  const context = { developer: false, groupTool: undefined, commandMentions: undefined, onOpenImage: undefined, onCopy: undefined, answer: undefined, artifacts: undefined, pieces: { mentions: true, skills: [] } };
  const html = renderToStaticMarkup(createElement(RowView, { row: { key: 'u', type: 'user', message: user('see @feedback/fb_7Q2mK9xRt4vW1cZp.md and @notes/plan.md') }, context }));
  assert.match(html, /data-testid="feedback-mention" data-path="feedback\/fb_7Q2mK9xRt4vW1cZp.md"/);
  assert.match(html, /data-testid="message-mention" data-path="notes\/plan.md"/);
});
