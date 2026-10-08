// Feedback tickets (FEEDBACK.md, "Tickets"): the GitHub and file sinks, `createTicketSinks(...).mirror` over the example's SQLite
// workspace, the project metadata in the builder's instructions, and the composed example's builder turning a report into a ticket file on
// its keyless scripted model (load_skill boring-pm → feedback read → write tickets/<id>.md → present → the link). No network: GitHub is a
// fetch double, never a real repository. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTicketSinks, fileSink, githubSink, parseTicket, ticketRepoOf, withTicketOutcome } from '@hachej/boring-feedback/tickets';
import { captureAnnotation, fetchSaveEndpoint } from '@hachej/boring-feedback/ui';
import { builderAgent, boringPmSkill, ticketFromReport } from '../../examples/feedback/builder.mjs';
import { APP } from '../../examples/feedback/server.mjs';
import { checkSource } from '../../scripts/pi-policy.mjs';
import { authorized, openApp, openPage, policy, replyText, toolResults } from '../fixtures/feedback-app.mjs';
import { openWorkspaceResources } from '../fixtures/feedback-workspace.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const architecture = JSON.parse(readFileSync(new URL('../../ARCHITECTURE.json', import.meta.url), 'utf8'));
const TOKEN = 'ghp_fictionalTokenNeverReal0000';
const PROJECT = { name: 'Fernhill Studio', repos: [{ repo: 'fernhill-fictional/docs' }, { repo: 'fernhill-fictional/studio-app', role: 'app' }] };
const TICKET = { id: 't1', title: '[besoin] Save says what it saves', body: '### Ce qui deviendrait plus simple\n\n- It should say what it saves.', labels: ['kind:feature', 'by:pm-agent'] };
const text = bytes => new TextDecoder().decode(bytes);

/** A fetch double for the GitHub REST API: records every request and answers `status` with `body`. */
function fakeGithub(status = 201, body = { number: 7, html_url: 'https://github.invalid/fernhill-fictional/studio-app/issues/7' }) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url: String(url), method: init.method, headers: init.headers, body: JSON.parse(init.body) }); return Response.json(body, { status }); };
  return { calls, fetch };
}

// ---------------------------------------------------------------- sinks
test('githubSink: one POST to the app repository with the token, title, body and labels', async () => {
  const github = fakeGithub();
  const sink = githubSink({ token: TOKEN, fetch: github.fetch, apiUrl: 'https://github.invalid/api/' });
  assert.equal(sink.name, 'github');
  assert.equal(sink.accepts(PROJECT), true);
  assert.equal(sink.accepts({ name: 'Empty', repos: [] }), false);
  assert.equal(sink.accepts({ name: 'Odd', repos: [{ repo: 'not a repo' }] }), false);
  assert.equal(ticketRepoOf({ name: 'x', repos: [{ repo: 'a/one' }, { repo: 'a/two' }] }), 'a/one', 'without an app role, the first repository');
  const result = await sink.publish(TICKET, { project: PROJECT });
  assert.deepEqual(result, { url: 'https://github.invalid/fernhill-fictional/studio-app/issues/7' });
  assert.equal(github.calls.length, 1);
  const [call] = github.calls;
  assert.equal(call.url, 'https://github.invalid/api/repos/fernhill-fictional/studio-app/issues');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(call.headers.accept, 'application/vnd.github+json');
  assert.deepEqual(call.body.labels, ['kind:feature', 'by:pm-agent', 'source:feedback']);
  assert.equal(call.body.title, TICKET.title);
  assert.ok(call.body.body.startsWith(TICKET.body) && call.body.body.includes('<!-- boring-ticket: t1 -->'));
  assert.ok(!JSON.stringify(sink).includes(TOKEN), 'the token is not on the sink object');
  assert.throws(() => githubSink({ token: '' }), /token is required/);
});

test('githubSink: 401, 403, 404, 422 and 500 are refusals with plain reasons, never retried, never naming the token', async () => {
  const cases = [[401, /refused the token \(401\)/], [403, /denied access \(403\).*fernhill-fictional\/studio-app/], [404, /cannot see fernhill-fictional\/studio-app \(404\)/],
    [422, /refused the issue \(422\): Validation Failed/], [500, /answered 500; nothing is known to be filed/]];
  for (const [status, reason] of cases) {
    const github = fakeGithub(status, { message: 'Validation Failed' });
    const result = await githubSink({ token: TOKEN, fetch: github.fetch }).publish(TICKET, { project: PROJECT });
    assert.match(result.refused, reason, String(status));
    assert.ok(!result.refused.includes(TOKEN));
    assert.equal(github.calls.length, 1, `${status} is not retried`);
  }
  const offline = await githubSink({ token: TOKEN, fetch: async () => { throw new TypeError('fetch failed'); } }).publish(TICKET, { project: PROJECT });
  assert.match(offline.refused, /did not answer; the issue may or may not exist/);
  const noLink = await githubSink({ token: TOKEN, fetch: fakeGithub(201, {}).fetch }).publish(TICKET, { project: PROJECT });
  assert.match(noLink.refused, /sent no link/);
});

test('fileSink: accepts any project and answers the ticket link', async () => {
  const sink = fileSink({ linkFor: ticket => `https://fernhill.invalid/tickets/${ticket.id}` });
  assert.equal(sink.accepts({ name: 'Empty', repos: [] }), true);
  assert.deepEqual(await sink.publish(TICKET, { project: PROJECT }), { url: 'https://fernhill.invalid/tickets/t1' });
});

test('parseTicket and withTicketOutcome: JSON front matter, title fallbacks, the outcome field set in place', () => {
  const markdown = '---\ntitle: "[besoin] A"\nlabels: ["kind:feature", "kind:feature", "x"]\nfeedback: fb_x\n---\n\n# Heading\n\nBody';
  const parsed = parseTicket('t1', markdown);
  assert.deepEqual(parsed.ticket, { id: 't1', title: '[besoin] A', body: '# Heading\n\nBody', labels: ['kind:feature', 'x'] });
  assert.equal(parsed.fields.feedback, 'fb_x');
  assert.equal(parsed.outcome, undefined);
  assert.equal(parseTicket('t2', '# Only a heading\n\ntext').ticket.title, 'Only a heading');
  assert.equal(parseTicket('t3', 'plain').ticket.title, 't3');
  const once = withTicketOutcome(markdown, { sink: 'file', state: 'publishing' });
  const twice = withTicketOutcome(once, { sink: 'file', url: 'https://fernhill.invalid/tickets/t1' });
  assert.deepEqual(parseTicket('t1', twice).outcome, { sink: 'file', url: 'https://fernhill.invalid/tickets/t1' });
  assert.equal(twice.match(/^ticket:/gm).length, 1);
  assert.ok(twice.endsWith('\n\n# Heading\n\nBody'), 'the body is unchanged');
  assert.deepEqual(parseTicket('t4', withTicketOutcome('no front matter', { refused: 'none' })).outcome, { refused: 'none' });
});

// ---------------------------------------------------------------- the trigger
async function openResources(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-tickets-'));
  const resources = await openWorkspaceResources(join(directory, 'tickets.sqlite'), 'fernhill-tickets', 'fernhill-studio');
  t.after(() => { resources.close(); rmSync(directory, { recursive: true, force: true }); });
  return resources;
}
const ACCESS = { scopeId: 'fernhill-studio', principalId: 'p_fictional_builder', initiatorId: 'p_fictional_ada' };
const at = path => ({ resource: { providerId: 'fernhill-tickets', path }, view: { kind: 'published' } });
/** What the agent's `write` does: a new file (here through the provider, so the test needs no conversation). Returns its revision. */
const write = async (resources, path, content) => {
  const result = await resources.publication.publish({ operationId: `write-${path}-${Math.random()}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: at(path), expected: { kind: 'absent' }, bytes: new TextEncoder().encode(content), mediaType: 'text/markdown' }] }, ACCESS);
  assert.equal(result.kind, 'committed');
  return result.receipt.changes[0].after.revision;
};
const latest = async (resources, path) => { const read = await resources.read({ target: at(path), revision: { kind: 'latest' } }, ACCESS); return read.kind === 'available' ? { text: text(read.snapshot.bytes), revision: read.snapshot.ref.revision } : read; };
const sinksOver = (files, project, sinks) => createTicketSinks({ files, project, sinks });
function countingSink(name, answer = ticket => ({ url: `https://tracker.invalid/${name}/${ticket.id}` }), accepts = () => true) {
  const published = [];
  return { published, sink: { name, accepts, publish: async (ticket, context) => { published.push({ ticket, project: context.project }); return answer(ticket); } } };
}
const BODY = '---\ntitle: "[besoin] Save says what it saves"\nlabels: ["kind:feature","by:pm-agent"]\nfeedback: "fb_fictional"\n---\n\n### Acceptance criteria\n\n- [ ] AC-1: it says what it saves\n';

test('a ticket file created under tickets/ is published once by the first accepting sink and the link is written back', async t => {
  const resources = await openResources(t);
  const github = countingSink('github', undefined, project => project.repos.length > 0);
  const file = countingSink('file');
  const tickets = sinksOver(resources.files, { name: 'Fernhill Studio', repos: [] }, [github.sink, file.sink]);
  const created = await write(resources, 'tickets/t1.md', BODY);
  const mirrored = await tickets.mirror('tickets/t1.md', ACCESS, created);
  assert.deepEqual(mirrored, { kind: 'recorded', outcome: { sink: 'file', url: 'https://tracker.invalid/file/t1' } });
  assert.equal(github.published.length, 0, 'GitHub does not accept a project with no repository');
  assert.equal(file.published.length, 1);
  assert.deepEqual(file.published[0].ticket, { id: 't1', title: '[besoin] Save says what it saves', body: '### Acceptance criteria\n\n- [ ] AC-1: it says what it saves', labels: ['kind:feature', 'by:pm-agent'] });
  assert.deepEqual(file.published[0].project, { name: 'Fernhill Studio', repos: [] });
  const after = await latest(resources, 'tickets/t1.md');
  assert.deepEqual(parseTicket('t1', after.text).outcome, { sink: 'file', url: 'https://tracker.invalid/file/t1' });
  assert.notEqual(after.revision, created, 'the outcome is a new revision of the ticket');

  // A second call (a replayed write, a restarted host) finds the recorded outcome and publishes nothing.
  assert.equal((await tickets.mirror('tickets/t1.md', ACCESS, created)).kind, 'skipped');
  assert.equal((await tickets.mirror('tickets/t1.md', ACCESS)).kind, 'skipped');
  assert.equal(file.published.length, 1, 'never published twice');
  assert.equal((await latest(resources, 'tickets/t1.md')).revision, after.revision);
});

test('files outside tickets/ are not tickets; no accepting sink, a refusal and a throwing sink are recorded refusals', async t => {
  const resources = await openResources(t);
  const file = countingSink('file');
  const tickets = sinksOver(resources.files, { name: 'Fernhill Studio', repos: [] }, [file.sink]);
  for (const path of ['artifacts/a.md', 'tickets/notes.txt', 'tickets/nested/x.md', 'feedback/t9.md']) {
    const revision = await write(resources, path, BODY);
    assert.equal(tickets.isTicket(path), false, path);
    assert.deepEqual(await tickets.mirror(path, ACCESS, revision), { kind: 'skipped', reason: 'Not a ticket path' });
    assert.equal((await latest(resources, path)).text, BODY, path);
  }
  assert.equal(file.published.length, 0);

  const nobody = sinksOver(resources.files, { name: 'Fernhill Studio', repos: [] }, [countingSink('github', undefined, () => false).sink]);
  await nobody.mirror('tickets/t2.md', ACCESS, await write(resources, 'tickets/t2.md', BODY));
  assert.deepEqual(parseTicket('t2', (await latest(resources, 'tickets/t2.md')).text).outcome, { refused: 'No ticket sink accepts the project "Fernhill Studio"' });

  const refusing = countingSink('github', () => ({ refused: 'GitHub refused the token (401): it is missing, expired or revoked.' }));
  const refused = sinksOver(resources.files, PROJECT, [refusing.sink]);
  const t3 = await write(resources, 'tickets/t3.md', BODY);
  await refused.mirror('tickets/t3.md', ACCESS, t3);
  assert.deepEqual(parseTicket('t3', (await latest(resources, 'tickets/t3.md')).text).outcome, { sink: 'github', refused: 'GitHub refused the token (401): it is missing, expired or revoked.' });
  await refused.mirror('tickets/t3.md', ACCESS, t3);
  assert.equal(refusing.published.length, 1, 'a refusal is recorded once and not retried');

  const throwing = sinksOver(resources.files, PROJECT, [{ name: 'github', accepts: () => true, publish: async () => { throw new Error('socket hang up'); } }]);
  await throwing.mirror('tickets/t4.md', ACCESS, await write(resources, 'tickets/t4.md', BODY));
  assert.match(parseTicket('t4', (await latest(resources, 'tickets/t4.md')).text).outcome.refused, /did not complete \(socket hang up\)/);
});

test('a ticket field written by the author is not trusted; a claim left by a lost outcome is never published again', async t => {
  const resources = await openResources(t);
  const file = countingSink('file');
  const tickets = sinksOver(resources.files, { name: 'Fernhill Studio', repos: [] }, [file.sink]);
  const forged = BODY.replace('---\n\n', 'ticket: {"sink":"github","url":"https://evil.invalid/x"}\n---\n\n');
  await tickets.mirror('tickets/t5.md', ACCESS, await write(resources, 'tickets/t5.md', forged));
  assert.equal(file.published.length, 1);
  assert.deepEqual(parseTicket('t5', (await latest(resources, 'tickets/t5.md')).text).outcome, { sink: 'file', url: 'https://tracker.invalid/file/t5' });

  // The process stopped between the sink's publication and the outcome write: the claim stays, and a second call publishes nothing.
  let lose = true;
  const crashing = { ...resources.files, publication: { publish: async (request, access) => {
    const writing = new TextDecoder().decode(request.changes[0].bytes);
    if (lose && /^ticket: \{"sink":"file","url"/m.test(writing)) { lose = false; throw new Error('fictional crash'); }
    return resources.files.publication.publish(request, access);
  } } };
  const once = countingSink('file');
  const t6 = await write(resources, 'tickets/t6.md', BODY);
  await sinksOver(crashing, { name: 'Fernhill Studio', repos: [] }, [once.sink]).mirror('tickets/t6.md', ACCESS, t6);
  assert.deepEqual(parseTicket('t6', (await latest(resources, 'tickets/t6.md')).text).outcome, { sink: 'file', state: 'publishing' });
  await sinksOver(resources.files, { name: 'Fernhill Studio', repos: [] }, [once.sink]).mirror('tickets/t6.md', ACCESS, t6);
  assert.equal(once.published.length, 1, 'at most once');
});

// ---------------------------------------------------------------- the builder
test('project metadata and the boring-pm skill reach the builder; without tickets it is unchanged', async t => {
  const resources = await openResources(t);
  const fakeStore = (await openApp(t)).store;
  const tickets = { files: resources.files, root: resources.root, sinks: sinksOver(resources.files, PROJECT, []) };
  const { definition } = await builderAgent({ store: fakeStore, accessOf: () => ACCESS, page: {}, tickets, project: PROJECT, provider: '' });
  assert.match(definition.agent.instructions, /Project: Fernhill Studio\. Repositories: fernhill-fictional\/docs, fernhill-fictional\/studio-app \(app\)\./);
  assert.match(definition.agent.instructions, /load_skill for boring-pm/);
  assert.deepEqual(definition.skills.map(skill => skill.name), ['boring-pm']);
  const tools = definition.extensions.flatMap(extension => extension.tools ?? []).map(tool => tool.name);
  for (const name of ['edit_page', 'read', 'write', 'edit', 'present', 'load_skill', 'feedback']) assert.ok(tools.includes(name), name);
  const wraps = definition.extensions.flatMap(extension => extension.wraps ?? []).map(wrap => wrap.tool);
  assert.deepEqual(wraps, ['read', 'write', 'edit', 'write'], 'the file guard, then the ticket trigger on write');
  const empty = await builderAgent({ store: fakeStore, accessOf: () => ACCESS, page: {}, tickets, project: { name: 'Fernhill Studio', repos: [] }, provider: '' });
  assert.match(empty.definition.agent.instructions, /Repositories: none \(tickets stay as files in this workspace\)/);
  const bare = await builderAgent({ store: fakeStore, accessOf: () => ACCESS, page: {}, provider: '' });
  assert.ok(!/Project:/.test(bare.definition.agent.instructions));
  assert.deepEqual(bare.definition.skills, []);

  // The vendored skill is the pinned upstream text: SKILL.md's body first, then each file it links.
  const skill = boringPmSkill();
  const source = JSON.parse(readFileSync(new URL('../../examples/feedback/skills/boring-pm/SOURCE.json', import.meta.url), 'utf8'));
  assert.deepEqual([source.repo, source.commit], ['hachej/boring-pm', '1da5e470985990b3cb110e40966e82989e7b0d0b']);
  assert.equal(skill.name, 'boring-pm');
  assert.ok(skill.body.startsWith('# Boring PM'));
  assert.ok(skill.body.includes(`<file path="tickets.md">\n${readFileSync(new URL('../../examples/feedback/skills/boring-pm/tickets.md', import.meta.url), 'utf8').trim()}\n</file>`));
});

const TICKET_PAGE = `<div id="fernhill-app"><main data-feedback-visible=""><h1>Workspace settings</h1>
  <form><button type="submit" data-feedback-id="save-profile" data-testid="save-profile" data-source="examples/feedback/settings/SettingsPage.jsx:88">Save profile</button></form>
  <aside><p>Mara Quill paid invoice F-2210</p></aside></div>`;

/** Ada saves a report with two notes (one on Save, one general) through the app's route, as the composer does. */
async function saveReportWithNotes(t, app) {
  const page = openPage(t, TICKET_PAGE);
  const capture = await captureAnnotation({ app: APP, build: 'dev-ticket', policy, root: page.root }, [page.document.querySelector('[data-testid=save-profile]')]);
  const draft = { observed: capture.observed, anchors: capture.anchors, said: '', notes: [{ text: 'It should say what it saves.', anchor: 0 }, { text: 'Saving should keep me on this section.' }],
    steps: [{ kind: 'note', note: 0 }, { kind: 'click', target: 'Billing' }, { kind: 'note', note: 1 }] };
  const saved = await fetchSaveEndpoint(new URL('/api/feedback', app.url), authorized(app, 'ada'))({ operationId: 'op-ticket-report-1', draft });
  assert.equal(saved.kind, 'saved', JSON.stringify(saved));
  return saved.id;
}

test('the scripted builder turns a report into a boring-pm ticket file, filed by the file sink, presents it and replies with its link', async t => {
  const app = await openApp(t);
  const id = await saveReportWithNotes(t, app);
  const turn = await app.say('ada', `create a ticket for ${id}`);
  const results = toolResults(turn.filter(message => message.toolName !== 'load_skill'));
  const skillResult = turn.find(message => message.role === 'toolResult' && message.toolName === 'load_skill');
  assert.ok(skillResult && skillResult.content[0].text.startsWith('# Boring PM') && skillResult.content[0].text.includes('## File a feature'), 'the skill is loaded with load_skill');
  assert.deepEqual(turn.filter(message => message.role === 'toolResult').map(message => message.toolName), ['load_skill', 'feedback', 'write', 'present']);
  const presented = results.find(result => result.name === 'present').value;
  assert.equal(presented.kind, 'presented');
  assert.equal(presented.artifact.target.resource.path, `tickets/${id}.md`);
  const stored = await app.files.read({ target: presented.artifact.target, revision: { kind: 'latest' } }, app.people.ada.access);
  const back = { id, content: new TextDecoder().decode(stored.snapshot.bytes) };
  assert.equal(stored.snapshot.ref.revision, presented.artifact.revision, 'present shows the revision with the sink outcome');
  const link = `${app.url}tickets/${id}`;
  assert.deepEqual(parseTicket(back.id, back.content).outcome, { sink: 'file', url: link }, 'the ticket records the sink outcome');
  assert.equal(replyText(turn), `Ticket for ${id} filed (file): ${link} Please review it.`);

  // The ticket: boring-pm title, labels and sections, the notes in order, the element with file:line, the route, acceptance criteria.
  const ticket = parseTicket(back.id, back.content);
  assert.equal(ticket.ticket.title, '[besoin] It should say what it saves.');
  assert.deepEqual(ticket.ticket.labels, ['kind:feature', 'by:pm-agent']);
  assert.equal(ticket.fields.feedback, id);
  assert.equal(ticket.fields.route, '/settings/:section');
  for (const section of ['### Ce qui deviendrait plus simple', "### Comment vous faites aujourd'hui", '### Exemples concrets (fictifs)', '### Ce qui ne doit surtout pas changer', '### Acceptance criteria']) assert.ok(ticket.ticket.body.includes(section), section);
  assert.match(ticket.ticket.body, /1\. ① Note on .*Save profile.*\(`examples\/feedback\/settings\/SettingsPage\.jsx:88`\): "It should say what it saves\."\n2\. Clicked Billing\n3\. ② Note on the page in general: "Saving should keep me on this section\."/);
  assert.match(ticket.ticket.body, /- \[ \] AC-1: on `\/settings\/:section`, .*Save profile.*: It should say what it saves\./);
  assert.ok(!/Mara Quill|F-2210|p_fictional_ada|Ada Fictional/.test(back.content), 'only masked report content: no page text, no author');

  // The link opens the ticket (file sink).
  const page = await fetch(link);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-testid="ticket-title">\[besoin\] It should say what it saves\.</);
  assert.match(html, /<h3>Acceptance criteria<\/h3>/);
  assert.match(html, /SettingsPage\.jsx:88/);
  assert.equal((await fetch(`${app.url}tickets/..%2Fsecret`)).status, 404);

  // "create a ticket" with no id is about the last report mentioned; a second ticket is a new file, published once.
  const again = await app.say('ada', `@feedback/${id}.md create a ticket`);
  assert.equal(replyText(again), `Ticket for ${id} filed (file): ${app.url}tickets/${id}-2 Please review it.`);
});

test('with a repository and a token the same flow files a GitHub issue (fetch double only)', async t => {
  const github = fakeGithub(201, { number: 12, html_url: 'https://github.invalid/fernhill-fictional/studio-app/issues/12' });
  const app = await openApp(t, { project: PROJECT, ticketSinks: ({ linkFor }) => [githubSink({ token: TOKEN, fetch: github.fetch, apiUrl: 'https://github.invalid/api' }), fileSink({ linkFor })] });
  const id = await saveReportWithNotes(t, app);
  const turn = await app.say('ada', `ticket ${id}`);
  assert.equal(replyText(turn), `Ticket for ${id} filed (github): https://github.invalid/fernhill-fictional/studio-app/issues/12 Please review it.`);
  assert.equal(github.calls.length, 1);
  assert.equal(github.calls[0].url, 'https://github.invalid/api/repos/fernhill-fictional/studio-app/issues');
  assert.deepEqual(github.calls[0].body.labels, ['kind:feature', 'by:pm-agent', 'source:feedback']);
  assert.match(github.calls[0].body.body, /### Acceptance criteria/);
  const messages = JSON.stringify(await app.messages('ada'));
  assert.ok(!messages.includes(TOKEN), 'the token never reaches the conversation');
});

// ---------------------------------------------------------------- boundaries
test('the tickets subpath is never in a browser bundle; browser folders cannot import it, and it cannot import them', async () => {
  const result = await build({ stdin: { contents: "export * from '@hachej/boring-feedback/page'; export * from '@hachej/boring-feedback/ui'; export * from '@hachej/boring-feedback/format';", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  assert.deepEqual(Object.keys(result.metafile.inputs).filter(path => /feedback\/dist\/tickets\//.test(path)), []);
  for (const folder of ['page', 'ui', 'format', 'store', 'agent', 'source']) {
    const errors = checkSource(`packages/feedback/src/${folder}/probe.ts`, "import { fileSink } from '../tickets/index.js';\nexport const x = fileSink;\n", architecture);
    assert.ok(errors.some(error => /forbidden relative import/.test(error)), `${folder}: ${errors.join('; ')}`);
  }
  assert.ok(checkSource('packages/feedback/src/tickets/probe.ts', "import { parseFeedback } from '../format/index.js';\nexport const x = parseFeedback;\n", architecture).some(error => /forbidden relative import/.test(error)));
  assert.ok(checkSource('packages/feedback/src/tickets/probe.ts', "import { defineAgent } from '@hachej/boring-agent/agents';\nexport const x = defineAgent;\n", architecture).some(error => /forbidden import/.test(error)));
  assert.equal(typeof ticketFromReport, 'function');
});
