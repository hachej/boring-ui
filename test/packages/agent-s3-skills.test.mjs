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

// ---- validate hook, lastRejected, refresh on miss, flexible layout ----

/** An agent whose model can call load_skill; `load(conversation, name)` returns the tool's answer. */
async function loader(t, source, options = {}) {
  const answers = [];
  const scripted = createScriptedModel({ generic: [], script: { 'load ': [
    ctx => ({ tools: [{ name: 'load_skill', args: { name: ctx.input.slice('load '.length) } }] }),
    ctx => { answers.push(ctx.results[0]?.text); return 'Loaded.'; },
  ] } });
  const skills = liveSkills(source, { name: 'fictional.skills', maxAgeMs: 600000, ...options });
  const agent = defineAgent({ id: 'fictional-clerk', model: scripted.model, instructions: 'You file fictional letters.', extensions: [skills.extension] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: scripted.models }, context);
  t.after(() => harness.close(context).catch(() => {}));
  const load = async (conversation, name) => {
    assert.equal((await (await conversation.submit({ type: 'input', content: `load ${name}` }, context)).wait(context)).status, 'done');
    return answers.at(-1);
  };
  return { skills, open: () => agent.createConversation(harness, context), load };
}
const manifestReads = b => b.calls.filter(call => call.key.endsWith('current.json')).length;

test('validate sees the whole fetched set and may refuse it; lastRejected says which, and clears on a good set', async () => {
  const b = bucket(), seen = [];
  const source = s3SkillSource({
    client: b.client, region: 'eu-west-1', bucket: 'clinic', prefix: 'skills',
    validate: async (files, ctx, version) => {
      seen.push({ version, files: files.map(file => [file.path, file.sha256, file.text.length > 0]), ctx: ctx === context });
      if (files.some(file => file.text.includes('FORBIDDEN'))) return 'a skill mentions FORBIDDEN';
      if (files.some(file => file.text.includes('BOOM'))) throw new Error('hook crashed');
    },
  });
  b.publish('v1', V1);
  assert.deepEqual((await source.list(context)).errors, []);
  assert.equal(source.lastRejected(), undefined);
  assert.deepEqual(seen[0], { version: 'v1', files: [['letters/SKILL.md', sha(V1['letters/SKILL.md']), true]], ctx: true });

  b.publish('v2', { ...V2, 'invoices/SKILL.md': skillText('invoices', 'FORBIDDEN') });
  const listing = await source.list(context);
  assert.match(listing.errors[0].message, /a skill mentions FORBIDDEN/);
  assert.deepEqual(listing.skills.map(skill => skill.name), ['letters'], 'the last good set stays');
  const rejected = source.lastRejected();
  assert.equal(rejected.version, 'v2');
  assert.match(rejected.reason, /a skill mentions FORBIDDEN/);
  assert.deepEqual(rejected.files, ['letters/SKILL.md', 'invoices/SKILL.md']);
  assert.equal(typeof rejected.at, 'number');
  assert.equal(source.lastRefreshed().version, 'v1');
  assert.match(source.lastRefreshed().failed.message, /FORBIDDEN/, 'failed keeps working: it holds this refusal too');

  b.publish('v3', { ...V2, 'invoices/SKILL.md': skillText('invoices', 'BOOM') });
  await source.list(context);
  assert.match(source.lastRejected().reason, /hook crashed/);
  assert.equal(source.lastRejected().version, 'v3');

  b.publish('v4', V2);
  assert.equal((await source.list(context)).skills.length, 2);
  assert.equal(source.lastRejected(), undefined, 'cleared when a later set is accepted');
  assert.equal(source.lastRefreshed().failed, undefined);
});

test('lastRejected covers hash, parse, duplicate and missing-file refusals, but not a failed read', async () => {
  const b = bucket(); b.publish('v1', V1);
  const source = setup(b);
  await source.list(context);
  const dup = { 'a/SKILL.md': skillText('same', 'x'), 'b/SKILL.md': skillText('same', 'y') };
  for (const [label, publish, pattern] of [
    ['hash', () => b.publish('v2', V2, { tamper: { 'invoices/SKILL.md': 'swapped' } }), /does not match its hash/],
    ['parse', () => b.publish('v2', { ...V2, 'invoices/SKILL.md': 'no front matter' }), /invoices\/SKILL.md/],
    ['duplicate', () => b.publish('v2', dup), /duplicate skill same/],
    ['missing', () => { b.publish('v2', V2); b.objects.delete('clinic/skills/v2/invoices/SKILL.md'); }, /listed but missing/],
    ['manifest', () => b.put('skills/current.json', '{nope'), /not JSON/],
  ]) {
    publish();
    await source.list(context);
    const rejected = source.lastRejected();
    assert.match(rejected.reason, pattern, label);
    assert.equal(rejected.version, label === 'manifest' ? undefined : 'v2', label);
  }
  const before = source.lastRejected();
  const failing = s3SkillSource({ client: { getText: async () => { throw new Error('network down'); } }, region: 'r', bucket: 'clinic' });
  await failing.list(context);
  assert.equal(failing.lastRejected(), undefined, 'a read that threw refused no set');
  assert.match(failing.lastRefreshed().failed.message, /network down/);
  assert.equal(source.lastRejected(), before);
});

test('load_skill on an unknown name asks the source once: the manifest alone when unchanged, the new set when it moved', async t => {
  const b = bucket(); b.publish('v1', V1);
  const source = setup(b), { skills, open, load } = await loader(t, source);
  const running = await open();
  assert.match(await load(running, 'letters'), /Fictional Clinic/);
  b.calls.length = 0;

  assert.match(await load(running, 'invoices'), /Unknown skill "invoices"/);
  assert.equal(manifestReads(b), 1, 'one cheap check for the miss');
  assert.equal(b.calls.length, 1, 'nothing but the manifest was read: the set did not change');

  b.calls.length = 0;
  b.publish('v2', V2);
  const missed = await load(running, 'invoices');
  assert.match(missed, /Unknown skill "invoices"/, 'a running conversation stays on its version');
  assert.match(missed, /newer skill version \(v2\)/);
  assert.equal(manifestReads(b), 1);
  assert.deepEqual(b.calls.filter(call => !call.key.endsWith('current.json')).map(call => call.key).sort(), ['skills/v2/invoices/SKILL.md', 'skills/v2/letters/SKILL.md'], 'the changed set was fetched once');

  b.calls.length = 0;
  assert.match(await load(await open(), 'invoices'), /fictional rate card/, 'a new conversation finds it on the first try');
  assert.equal(skills.visible(running.id), 'v1');
  assert.equal(b.calls.length, 0, 'no further read: the version is current');
});

test('concurrent misses share one manifest check', async t => {
  const b = bucket(); b.publish('v1', V1);
  const slow = { getText: async (location, ctx) => { if (location.key.endsWith('current.json')) await new Promise(resolve => setTimeout(resolve, 80)); return b.client.getText(location, ctx); } };
  const source = s3SkillSource({ client: slow, region: 'eu-west-1', bucket: 'clinic', prefix: 'skills' });
  const { open, load } = await loader(t, source);
  const [one, two] = [await open(), await open()];
  await load(one, 'letters'); await load(two, 'letters');
  b.calls.length = 0;
  await Promise.all([load(one, 'nothing'), load(two, 'other')]);
  assert.equal(manifestReads(b), 1);
});

test('version() reads only the manifest while it is unchanged', async () => {
  const b = bucket(); b.publish('v1', V1);
  const source = setup(b);
  const first = await source.version(context);
  b.calls.length = 0;
  assert.equal(await source.version(context), first);
  assert.equal(await source.version(context), first);
  assert.deepEqual(b.calls.map(call => call.key), ['skills/current.json', 'skills/current.json']);
});

test('layout.fileKey places files anywhere under the prefix; manifest paths may be nested; keys stay checked', async () => {
  const nested = { 'team/a/letters/SKILL.md': skillText('letters', 'Deep.'), 'b/c/d/e/notes.txt': skillText('notes', 'Deeper.') };
  const manifest = JSON.stringify({ version: 'v7', files: Object.entries(nested).map(([path, text]) => ({ path, sha256: sha(text) })) });
  for (const [label, fileKey, keyOf] of [
    ['versioned folder', (version, path) => `skills/${version}/${path}`, (version, path) => `pre/skills/${version}/${path}`],
    ['flat @version', (version, path) => `${path}@${version}`, (version, path) => `pre/${path}@${version}`],
  ]) {
    const b = bucket();
    for (const [path, text] of Object.entries(nested)) b.put(keyOf('v7', path), text);
    b.put('pre/stable/manifest.json', manifest);
    const source = s3SkillSource({ client: b.client, region: 'eu-west-1', bucket: 'clinic', prefix: 'pre', layout: { manifestKey: 'stable/manifest.json', fileKey } });
    const listing = await source.list(context);
    assert.deepEqual(listing.errors, [], label);
    assert.deepEqual(listing.skills.map(skill => skill.name).sort(), ['letters', 'notes'], label);
    assert.ok(b.calls.every(call => call.key === 'pre/stable/manifest.json' || call.key.startsWith('pre/')), label);
    assert.equal(source.lastRejected(), undefined);
  }
  // the default layout is unchanged
  const d = bucket(); d.publish('v1', V1);
  await setup(d).list(context);
  assert.deepEqual(d.calls.map(call => call.key), ['skills/current.json', 'skills/v1/letters/SKILL.md']);

  for (const bad of ['../outside/x', '/abs/x', 'a/../../b', 'a\\b']) {
    const b = bucket();
    b.put('current.json', manifest);
    const source = s3SkillSource({ client: b.client, region: 'eu-west-1', bucket: 'clinic', layout: { fileKey: () => bad } });
    const listing = await source.list(context);
    assert.match(listing.errors[0].message, /not a valid key/, bad);
    assert.equal(b.calls.length, 1, `${bad}: no file read`);
    assert.match(source.lastRejected().reason, /not a valid key/);
  }
  const thrower = s3SkillSource({ client: bucket().client, region: 'r', bucket: 'clinic', layout: { manifestKey: '../x' } });
  assert.match((await thrower.list(context)).errors[0].message, /manifest key is not a valid key/);
});
