import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createScriptedModel } from '@hachej/boring-testing/model';
import { defineAgent, liveSkills, reloadSkills, s3SkillSource } from '@hachej/boring-agent/agents';

// An S3 skill source over `current.json`, driven through the real harness with an injected fake client (no AWS). Fictional skills.

const skillText = (name, body) => `---\nname: ${name}\ndescription: Fictional ${name}\n---\n${body}\n`;
const sha = text => createHash('sha256').update(text).digest('hex');

function bucket() {
  const objects = new Map(), calls = [];
  const client = { getText: async location => { calls.push(location); return objects.get(`${location.bucket}/${location.key}`); } };
  const put = (key, text) => objects.set(`clinic/${key}`, text);
  /** Write a whole version, then (optionally) flip the manifest. `tamper` writes other bytes than the manifest hashes. */
  const publish = (version, files, { flip = true, tamper = {} } = {}) => {
    for (const [path, text] of Object.entries(files)) put(`skills/${version}/${path}`, tamper[path] ?? text);
    if (flip) put('skills/current.json', JSON.stringify({ version, files: Object.entries(files).map(([path, text]) => ({ path, sha256: sha(text) })) }));
  };
  return { client, put, publish, calls, objects };
}
const setup = b => s3SkillSource({ client: b.client, region: 'eu-west-1', bucket: 'clinic', prefix: '/skills/' });
const V1 = { 'letters/SKILL.md': skillText('letters', 'Sign as the Fictional Clinic.') };
const V2 = { 'letters/SKILL.md': skillText('letters', 'Sign as la Clinique Fictive.'), 'invoices/SKILL.md': skillText('invoices', 'Use the fictional rate card.') };

async function agentOver(t, source) {
  const seen = [];
  const scripted = createScriptedModel({ generic: [], script: { 'which skills': [ctx => { seen.push(ctx.system); return 'Listed.'; }] } });
  const skills = liveSkills(source, { name: 'fictional.skills', maxAgeMs: 0 });
  const agent = defineAgent({ id: 'fictional-clerk', model: scripted.model, instructions: 'You file fictional letters.', extensions: [skills.extension] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: scripted.models }, context);
  t.after(() => harness.close(context).catch(() => {}));
  const ask = async conversation => { assert.equal((await (await conversation.submit({ type: 'input', content: 'which skills' }, context)).wait(context)).status, 'done'); return seen.at(-1); };
  return { skills, open: () => agent.createConversation(harness, context), ask };
}

test('a bad set (hash mismatch, missing file, bad front matter) keeps the last good set; no half set is listed', async t => {
  const b = bucket(); b.publish('v1', V1);
  const source = setup(b), { skills, open, ask } = await agentOver(t, source);
  assert.match(await ask(await open()), /- letters: Fictional letters/);
  const good = source.lastRefreshed();
  assert.equal(good.version, 'v1');

  for (const [label, publish] of [
    ['hash', () => b.publish('v2', V2, { tamper: { 'invoices/SKILL.md': skillText('invoices', 'swapped') } })],
    ['missing', () => { b.publish('v2', V2); b.objects.delete('clinic/skills/v2/invoices/SKILL.md'); }],
    ['parse', () => b.publish('v2', { ...V2, 'invoices/SKILL.md': 'no front matter' })],
  ]) {
    publish();
    assert.equal(await skills.refresh(context), false, label);
    const system = await ask(await open());
    assert.match(system, /- letters: Fictional letters/, label);
    assert.doesNotMatch(system, /invoices/, `${label}: the good file of the bad set is not listed either`);
    assert.equal(source.lastRefreshed().version, 'v1', label);
    assert.equal(source.lastRefreshed().at, good.at, `${label}: lastRefreshed moves only on success`);
    assert.ok(source.lastRefreshed().failed?.message, label);
  }
});

test('the manifest switches the set atomically; a conversation keeps its version until refreshOnMigrate; visible says which', async t => {
  const b = bucket(); b.publish('v1', V1);
  const source = setup(b), { skills, open, ask } = await agentOver(t, source);
  const running = await open();
  await ask(running);
  const id = running.id;
  assert.equal(skills.visible(id), 'v1');

  b.publish('v2', V2, { flip: false });
  assert.doesNotMatch(await ask(await open()), /invoices/, 'files written, manifest not flipped: still v1');
  b.publish('v2', V2);
  assert.match(await ask(await open()), /- invoices:/, 'a new conversation starts on v2');
  assert.doesNotMatch(await ask(running), /invoices/, 'the running conversation keeps v1');
  assert.equal(skills.visible(id), 'v1');

  assert.equal(await skills.refreshOnMigrate(context, id), true);
  assert.equal(skills.visible(id), 'v2');
  assert.match(await ask(running), /- invoices:/);
  const refreshed = source.lastRefreshed();
  assert.equal(refreshed.version, 'v2');
  assert.equal(refreshed.failed, undefined);
});

test('admin reload reports which files changed before moving, and refuses a bad set', async t => {
  const b = bucket(); b.publish('v1', V1);
  const source = setup(b), { skills, open, ask } = await agentOver(t, source);
  await ask(await open());
  b.publish('v2', V2);
  const done = await reloadSkills(source, skills, context);
  assert.deepEqual([done.before.active, done.before.candidate], ['v1', 'v2']);
  assert.deepEqual(done.before.added, ['invoices/SKILL.md']);
  assert.deepEqual(done.before.changed, ['letters/SKILL.md']);
  assert.equal(done.reloaded, true);
  assert.equal(done.refresh.version, 'v2');

  b.publish('v3', V2, { tamper: { 'letters/SKILL.md': 'x' } });
  const refused = await reloadSkills(source, skills, context);
  assert.equal(refused.reloaded, false);
  assert.match(refused.before.error, /letters\/SKILL.md does not match its hash/);
  assert.equal(refused.refresh.version, 'v2');
  assert.match(await ask(await open()), /- invoices:/);
});

test('region, bucket and prefix reach the client; a manifest path outside the set is refused', async () => {
  const b = bucket(); b.publish('v1', V1);
  const source = setup(b);
  await source.list(context);
  assert.deepEqual(b.calls[0], { region: 'eu-west-1', bucket: 'clinic', key: 'skills/current.json' });
  b.put('skills/current.json', JSON.stringify({ version: 'v9', files: [{ path: '../secret.md', sha256: sha('x') }] }));
  const listing = await source.list(context);
  assert.match(listing.errors[0].message, /invalid or duplicate file/);
  assert.equal(listing.skills.length, 1, 'v1 stays');
});

test('a custom prefix and manifest key, and skill files whose key does not end in .md', async () => {
  const b = bucket();
  const files = { 'letters/SKILL': skillText('letters', 'No extension.'), 'notes/skill.txt': skillText('notes', 'Text file.') };
  for (const [path, text] of Object.entries(files)) b.put(`team/a/b/v1/${path}`, text);
  b.put('team/a/b/manifest.json', JSON.stringify({ version: 'v1', files: Object.entries(files).map(([path, text]) => ({ path, sha256: sha(text) })) }));
  const source = s3SkillSource({ client: b.client, region: 'eu-west-1', bucket: 'clinic', prefix: 'team/a/b', manifest: 'manifest.json' });
  const listing = await source.list(context);
  assert.deepEqual(listing.errors, []);
  assert.deepEqual(listing.skills.map(skill => skill.name).sort(), ['letters', 'notes']);
  assert.equal(b.calls[0].key, 'team/a/b/manifest.json');
  assert.ok(b.calls.some(call => call.key === 'team/a/b/v1/letters/SKILL'));
  const bare = s3SkillSource({ client: b.client, region: 'r', bucket: 'clinic' });
  b.put('current.json', JSON.stringify({ version: 'v1', files: [] }));
  assert.equal((await bare.list(context)).errors.length, 0, 'no prefix: keys at the bucket root');
});
