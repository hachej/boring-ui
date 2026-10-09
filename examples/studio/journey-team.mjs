// Offline journey of the studio's `team` variant: ONE agent on ONE harness, two fictional people, each in their own workspace, driven
// through the real HTTP routes (chat transport, file tree, file viewer, resources) with the scripted model. No key, no browser. It proves:
//   - person A's agent writes notes.md in A's workspace; person B's agent cannot see it and writes its own; `present` and the viewers of
//     each person show only that person's files (B cannot read the revision A presented);
//   - the file guard's last-read state stays per conversation (and per workspace): A's second conversation may not edit A's notes.md
//     without reading it, although A's first conversation read it;
//   - a subagent's child conversation works in its parent's workspace;
//   - the harbour MCP server receives each person's own fictional credential, and no credential reaches a transcript;
//   - a person cannot use another person's conversation or the studio person's variants; idle workspaces close and reopen intact;
//   - self-evolution per workspace: A's agent writes and uses its own tool, B's agent is never offered it (each conversation selects
//     only its own `self-evolving:team-<person>`), and each person's /reload is their own; git per person (own commits, own Git tab);
//   - in two browsers (separate profiles, each person's own fictional token in the link): each sees only their own sessions, transcript,
//     presented artifact, files and canvas (each agent draws on its person's board.tldraw).
// Every tool takes its workspace from the env Pi resolved for the call (`workspace: 'env'`, @hachej/boring-agent/workspaces `withWorkspace`).
// Run: npm run build && CHROMIUM=<binary> node examples/studio/journey-team.mjs   (npm run studio:journey:team)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { lastReadRevisions } from '@hachej/boring-agent/file-guard';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createScriptedModels } from './scripted-model.mjs';
import { harbourCalls } from './fixtures/mcp-server.mjs';
import { startStudio } from './server.mjs';
import { launch } from '@hachej/boring-testing/browser';
import { createToolkit } from './journey-toolkit.mjs';

const call = (name, args) => ({ tools: [{ name, args }] });
const A_NOTES = "# A's notes\n\n- Fictional harbour visit\n", B_NOTES = "# B's notes\n\n- Invented lighthouse tour\n";
const SHOUT = { name: 'shout', description: 'Repeat the arguments in capitals.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, run: 'sh .agent/tools/shout.sh' };
const SCRIPT = [{ name: 'team journey', entries: Object.entries({
  'Team journey A: write notes': [
    call('read', { path: 'notes.md' }),
    call('write', { path: 'notes.md', content: A_NOTES }),
    call('present', { path: 'notes.md' }),
    call('harbour_tide_times', { date: '2031-05-04' }),
    ctx => `Saved. ${ctx.last.text}`,
  ],
  'Team journey B: look for notes': [
    call('read', { path: 'notes.md' }),
    ctx => ({ ...call('list_files', {}), text: ctx.last.isError ? 'No notes here.' : `Found: ${ctx.last.text}` }),
    call('write', { path: 'notes.md', content: B_NOTES }),
    call('present', { path: 'notes.md' }),
    call('harbour_tide_times', { date: '2031-05-05' }),
    ctx => `Saved mine. ${ctx.last.text}`,
  ],
  'Team journey A2: edit without reading': [
    call('edit', { path: 'notes.md', edits: [{ oldText: 'Fictional harbour visit', newText: 'Changed blind' }] }),
    ctx => `Edit result: ${ctx.last.isError ? 'refused' : 'applied'}: ${ctx.last.text}`,
  ],
  'Team journey A: delegate': [
    call('subagent', { task: 'Team child: read notes.md and quote its first line.' }),
    ctx => `The subagent says: ${ctx.last.text}`,
  ],
  'Team child: read notes.md': [call('read', { path: 'notes.md' }), ctx => `First line: ${ctx.last.text.split('\n')[0]}`],
  'Team journey A: after idle': [call('read', { path: 'notes.md' }), ctx => `Still there: ${ctx.last.text.split('\n')[0]}`],
  // Self-evolution in A's workspace: a tool A's agent writes for itself, then uses; B's agent is never offered it.
  'Team journey A: evolve': [
    call('write', { path: '.agent/tools/shout.sh', content: 'tr a-z A-Z\n' }),
    call('write', { path: '.agent/tools/shout.json', content: `${JSON.stringify(SHOUT, null, 2)}\n` }),
    call('reload', {}),
    ctx => `Reloaded: ${ctx.last.text}`,
  ],
  'Team journey A: shout': [ctx => ctx.tools.includes('shout') ? call('shout', { text: 'ahoy' }) : 'shout is not offered', ctx => `Shouted: ${ctx.last.text}`],
  'Team journey B: shout': [ctx => ctx.tools.includes('shout') ? 'LEAK: shout is offered to B' : call('reload', {}), ctx => `No shout here. ${ctx.last.text}`],
  // Git: each person's workspace is their own repository.
  'Team journey A: commit': [call('working_git', { operation: 'add', path: 'notes.md' }), call('working_git', { operation: 'commit', message: "A's notes" }), 'Committed.'],
  'Team journey B: commit': [call('working_git', { operation: 'add', path: 'notes.md' }), call('working_git', { operation: 'commit', message: "B's notes" }), 'Committed.'],
  // The canvas, drawn from each person's browser.
  'Team canvas A: draw': [call('read_canvas', {}), call('add_canvas_shapes', { shapes: [{ id: 'dock', kind: 'rectangle', text: 'A dock', x: 0, y: 0 }] }), 'Drawn.'],
  'Team canvas B: draw': [call('read_canvas', {}), call('add_canvas_shapes', { shapes: [{ id: 'light', kind: 'rectangle', text: 'B lighthouse', x: 0, y: 0 }] }), 'Drawn.'],
}).map(([match, turns]) => ({ match, turns })) }];

const steps = [];
const step = async (name, run) => { const started = Date.now(); await run(); steps.push(name); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

process.env.STUDIO_TEAM_IDLE_MS = '1500';
const directory = mkdtempSync(join(tmpdir(), 'boring-studio-team-'));
const { models, misses } = await createScriptedModels({ sources: SCRIPT });
const app = await startStudio({ directory, port: 0, modelsOverride: models, variants: ['team'], whatsapp: null });
const A = 'fictional-user-a', B = 'fictional-user-b';
const tokenOf = person => app.teamTokens[person];
const request = (person, path, init = {}) => fetch(new URL(path, app.url), { ...init, headers: { authorization: `Bearer ${tokenOf(person)}`, 'x-studio-variant': 'team', ...init.headers } });
const json = async (person, path, init) => { const response = await request(person, path, init); assert.equal(response.status, 200, `${person} ${path}: ${response.status}`); return response.json(); };
const team = app.host.variants.get('team');
let failed = false;

/** Submit one message as `person` through the chat transport and wait until the conversation (and its children) is idle. */
async function say(person, conversationId, text) {
  const response = await request(person, `/api/chat?conversation=${conversationId}&op=submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), content: text }) });
  assert.equal(response.status, 200, `submit as ${person}: ${response.status}`);
  const conversation = await app.harness.conversation(conversationId, context);
  await conversation.waitForIdle(context);
  const messages = (await conversation.context(context)).messages;
  const results = messages.filter(message => message.role === 'toolResult');
  const reply = messages.filter(message => message.role === 'assistant').at(-1)?.content.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
  return { reply, results, messages };
}
const artifactOf = results => results.map(result => { try { return JSON.parse(result.content[0].text).artifact; } catch { return undefined; } }).filter(Boolean).at(-1);

try {
  let conversationA, conversationB, presentedA;
  await step('each person sees only the team variant and their own conversation', async () => {
    const [a, b] = [await json(A, '/api/studio'), await json(B, '/api/studio')];
    assert.deepEqual(a.variants.map(variant => variant.id), ['team']);
    [conversationA] = a.variants[0].conversations; [conversationB] = b.variants[0].conversations;
    assert.ok(conversationA && conversationB && conversationA !== conversationB, `${conversationA} / ${conversationB}`);
    assert.ok(!b.variants[0].conversations.includes(conversationA));
  });

  await step('a person cannot drive another person\'s conversation, and the team people do not reach the studio person\'s variants', async () => {
    const stolen = await request(B, `/api/chat?conversation=${conversationA}&op=submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), content: 'Team journey B: look for notes' }) });
    assert.ok(stolen.status === 401 || stolen.status === 403, `B on A's conversation: ${stolen.status}`);
    assert.equal((await request(A, '/api/credits')).status, 404, 'the studio person\'s credits are not a team person\'s');
    assert.equal((await request(B, `/api/tasks?conversation=${conversationA}`)).status, 404);
  });

  await step('person A\'s agent writes and presents notes.md in A\'s workspace, reaching the harbour as A', async () => {
    const { reply, results } = await say(A, conversationA, 'Team journey A: write notes');
    assert.match(reply, /Saved\. Tides at Placeholder Pier on 2031-05-04/);
    presentedA = artifactOf(results);
    assert.equal(presentedA?.target.resource.path, 'notes.md');
  });

  await step('person B\'s agent does not see A\'s notes.md, writes its own, reaching the harbour as B', async () => {
    const { reply, results } = await say(B, conversationB, 'Team journey B: look for notes');
    assert.match(reply, /Saved mine\. Tides at Placeholder Pier on 2031-05-05/);
    const read = results.find(result => result.toolName === 'read');
    assert.equal(read.isError, true, `B's read of notes.md before writing: ${JSON.stringify(read.content)}`);
    assert.ok(!JSON.stringify(results).includes('harbour visit'), 'nothing of A\'s file reaches B');
    assert.notEqual(artifactOf(results).revision, presentedA.revision);
  });

  await step('the viewers of each person show only that person\'s files', async () => {
    const [filesA, filesB] = [await json(A, '/api/files'), await json(B, '/api/files')];
    assert.deepEqual(filesA.files, ['/workspace/notes.md', '/workspace/README.md']);
    assert.deepEqual(filesB.files, ['/workspace/notes.md', '/workspace/README.md']);
    assert.equal((await json(A, '/api/file?path=/workspace/notes.md')).text, A_NOTES);
    assert.equal((await json(B, '/api/file?path=/workspace/notes.md')).text, B_NOTES);
    // The presented card's resource: A reads the revision A's agent presented; B, asking for that same revision, gets nothing of A's.
    const clientOf = person => createResourceClient({ identity: { scopeId: `team-${person}`, principalId: person, initiatorId: person }, endpoint: new URL('/api/resources', app.url),
      fetch: outgoing => { const headers = new Headers(outgoing.headers); headers.set('authorization', `Bearer ${tokenOf(person)}`); headers.set('x-studio-variant', 'team'); return fetch(new Request(outgoing, { headers })); } });
    const exact = { target: presentedA.target, revision: { kind: 'exact', value: presentedA.revision } };
    const seenByA = await clientOf(A).read(exact);
    assert.equal(seenByA.kind, 'available');
    assert.equal(new TextDecoder().decode(seenByA.snapshot.bytes), A_NOTES);
    const seenByB = await clientOf(B).read(exact);
    assert.notEqual(seenByB.kind, 'available', `B reading A's presented revision: ${seenByB.kind}`);
    // A resource request claiming A's identity with B's token is refused.
    const forged = createResourceClient({ identity: { scopeId: `team-${A}`, principalId: A, initiatorId: A }, endpoint: new URL('/api/resources', app.url),
      fetch: outgoing => { const headers = new Headers(outgoing.headers); headers.set('authorization', `Bearer ${tokenOf(B)}`); headers.set('x-studio-variant', 'team'); return fetch(new Request(outgoing, { headers })); } });
    const outcome = await forged.read({ target: presentedA.target, revision: { kind: 'latest' } }).catch(() => ({ kind: 'rejected' }));
    assert.notEqual(outcome.kind, 'available', 'B\'s token with A\'s identity reads nothing');
  });

  await step('the file guard\'s last-read state stays per conversation: A\'s second conversation must read before editing', async () => {
    const created = await json(A, '/api/variants/team/conversations?op=create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const { reply } = await say(A, created.conversationId, 'Team journey A2: edit without reading');
    assert.match(reply, /Edit result: refused: Refused: notes\.md already exists and you have not read it in this conversation/);
    assert.equal((await json(A, '/api/file?path=/workspace/notes.md')).text, A_NOTES, 'nothing changed');
    const baselines = async id => Object.keys((await app.harness.snapshot(lastReadRevisions, id, context))?.revisions ?? {});
    assert.deepEqual(await baselines(conversationA), [`team-${A}:notes.md`]);
    assert.deepEqual(await baselines(conversationB), [`team-${B}:notes.md`]);
    assert.deepEqual(await baselines(created.conversationId), []);
  });

  await step('a subagent\'s child conversation works in its parent\'s workspace', async () => {
    const { reply } = await say(A, conversationA, 'Team journey A: delegate');
    assert.match(reply, /The subagent says: First line: # A's notes/);
  });

  await step('the harbour received each person\'s own credential; none reached a transcript', async () => {
    assert.deepEqual(harbourCalls.map(entry => [entry.tool, entry.credential]), [['tide_times', `fictional-harbour-token:${A}`], ['tide_times', `fictional-harbour-token:${B}`]]);
    for (const id of [conversationA, conversationB]) {
      const transcript = JSON.stringify((await (await app.harness.conversation(id, context)).context(context)).messages);
      assert.ok(!transcript.includes('fictional-harbour-token'), `conversation ${id} carries no credential`);
    }
  });

  await step('self-evolution per workspace: A\'s agent writes and uses its own tool; B\'s agent is never offered it', async () => {
    const evolved = await say(A, conversationA, 'Team journey A: evolve');
    assert.match(evolved.reply, /Reloaded: Reloaded \.agent\/ \(self-evolving:team-fictional-user-a\)\.\nTools added: shout\./);
    const shouted = await say(A, conversationA, 'Team journey A: shout');
    assert.match(shouted.reply, /Shouted: \{"TEXT":"AHOY"\}/);
    const other = await say(B, conversationB, 'Team journey B: shout');
    assert.match(other.reply, /No shout here\. Reloaded \.agent\/ \(self-evolving:team-fictional-user-b\)\.\nTools added: none\. Changed: none\. Removed: none\. Now: none\./);
    // The registry holds one extension per workspace; each person's conversations select only their own.
    const selected = async id => (await (await app.harness.conversation(id, context)).agent(context)).extensions.map(extension => extension.name);
    assert.ok((await selected(conversationA)).includes(`self-evolving:team-${A}`) && !(await selected(conversationA)).includes(`self-evolving:team-${B}`));
    assert.ok((await selected(conversationB)).includes(`self-evolving:team-${B}`) && !(await selected(conversationB)).includes(`self-evolving:team-${A}`));
    // Each person's /reload is their own workspace's.
    assert.match((await json(B, '/api/reload', { method: 'POST' })).text, /self-evolving:team-fictional-user-b[\s\S]*Now: none\./);
    assert.match((await json(A, '/api/reload', { method: 'POST' })).text, /self-evolving:team-fictional-user-a[\s\S]*Now: shout\./);
  });

  await step('git per person: each agent commits in its own repository; the Git tab of each person shows only theirs', async () => {
    assert.match((await say(A, conversationA, 'Team journey A: commit')).reply, /Committed/);
    assert.match((await say(B, conversationB, 'Team journey B: commit')).reply, /Committed/);
    const messages = async person => (await json(person, '/api/variant/git/log')).commits.map(commit => commit.message);
    assert.deepEqual(await messages(A), ["A's notes", 'Initial commit']);
    assert.deepEqual(await messages(B), ["B's notes", 'Initial commit']);
    assert.equal((await json(B, '/api/variant/git/file?path=notes.md')).text, B_NOTES);
  });

  await step('idle workspaces close; the next call reopens the person\'s workspace with its files', async () => {
    assert.ok(team.team.keys().length > 0, 'workspaces are open after use');
    const deadline = Date.now() + 15000;
    while (team.team.keys().length > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(team.team.keys(), [], 'every workspace closed once idle');
    const { reply } = await say(A, conversationA, 'Team journey A: after idle');
    assert.match(reply, /Still there: # A's notes/);
    assert.deepEqual(team.team.keys(), [A]);
    assert.match((await say(A, conversationA, 'Team journey A: shout')).reply, /Shouted: \{"TEXT":"AHOY"\}/, 'the reopened workspace still offers A\'s own tool');
  });

  // ---- Two people in two browsers (separate profiles), each with their own fictional token: sessions, transcript, files, artifacts, canvas.
  const evidence = process.env.STUDIO_EVIDENCE ?? '.cache/evidence/studio-team';
  mkdirSync(evidence, { recursive: true });
  const PANEL_TEXT = `(() => { const p = document.querySelector('[data-testid=workspace-panel]'); return p ? p.innerText + [...p.querySelectorAll('textarea')].map(e => e.value).join('') : ''; })()`;
  const browsers = {};
  try {
    for (const [person, own, other, conversation, shape, otherShape] of [[A, 'Fictional harbour visit', 'Invented lighthouse tour', conversationA, 'A dock', 'B lighthouse'], [B, 'Invented lighthouse tour', 'Fictional harbour visit', conversationB, 'B lighthouse', 'A dock']]) {
      await step(`${person} in their own browser sees only their sessions, transcript, files, artifact and canvas`, async () => {
        const browser = browsers[person] = await launch(`${app.url}#token=${tokenOf(person)}`, { evidence });
        const t = createToolkit({ browser, pageUrl: app.url, step: async (_name, run) => run(), app: () => app, base: app.url, authorize: request => fetch(request) });
        await t.ready();
        assert.equal(await browser.evaluate('location.hash'), '', 'the token left the address bar');
        // Sessions: exactly the person's conversations.
        const mine = (await json(person, '/api/studio')).variants[0].conversations.map(String).sort();
        await t.history.open();
        assert.deepEqual((await t.history.rows()).map(row => row.id).sort(), mine);
        await t.history.select(conversation);
        await browser.until('the transcript of the person\'s conversation', `${t.logText}.includes('Tides at Placeholder Pier')`, 20000);
        assert.ok(!(await browser.evaluate(t.logText)).includes(other === 'Invented lighthouse tour' ? '2031-05-05' : '2031-05-04'), 'nothing of the other person\'s transcript');
        // The artifact the person's agent presented opens with their own notes.
        await browser.click(`document.querySelector('[data-testid=transcript] [data-testid=artifact-card][data-state=ready]')`);
        await browser.until('the presented notes', `${PANEL_TEXT}.includes(${JSON.stringify(own)})`, 20000);
        assert.ok(!(await browser.evaluate(PANEL_TEXT)).includes(other));
        await t.closePanel();
        // The files of the person's workspace, and notes.md opened from the file tree.
        await t.tab('files');
        await browser.until('the file tree', `[...document.querySelectorAll('.studio-panel li button')].some(b => b.textContent === 'notes.md')`, 20000);
        await browser.click(`[...document.querySelectorAll('.studio-panel li button')].find(b => b.textContent === 'notes.md')`);
        await browser.until('notes.md in the viewer', `${PANEL_TEXT}.includes(${JSON.stringify(own)})`, 20000);
        assert.ok(!(await browser.evaluate(PANEL_TEXT)).includes(other));
        await t.closePanel();
        // The canvas: the person's agent draws, and the canvas opens with that shape and nothing of the other person's.
        await t.say(`Team canvas ${person === A ? 'A' : 'B'}: draw`);
        await browser.until('the person\'s canvas', `(document.querySelector('[data-testid=workspace-panel] [data-boring=canvas-stage]')?.textContent ?? '').includes(${JSON.stringify(shape)})`, 60000);
        await browser.until('idle', t.idle, 60000);
        assert.ok(!(await browser.evaluate(`document.querySelector('[data-testid=workspace-panel] [data-boring=canvas-stage]').textContent`)).includes(otherShape));
        await browser.screenshot(`team-${person}.png`);
      });
    }
    await step('after both drew, each person\'s saved canvas holds only their own shape', async () => {
      for (const [person, shape, otherShape] of [[A, 'A dock', 'B lighthouse'], [B, 'B lighthouse', 'A dock']]) {
        const { text } = await json(person, '/api/file?path=/workspace/board.tldraw');
        assert.ok(text.includes(shape) && !text.includes(otherShape), `${person}: ${text.slice(0, 200)}`);
      }
    });
  } finally {
    for (const browser of Object.values(browsers)) await browser.close().catch(() => {});
  }
  assert.deepEqual(misses, [], `unscripted messages: ${JSON.stringify(misses)}`);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await app.close();
}
console.log(failed ? 'team journey FAILED' : `team journey passed (${steps.length} steps)`);
process.exit(failed ? 1 : 0);
