import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createScriptedModel } from '@hachej/boring-testing/model';
import { defineAgent, directorySkillSource, liveSkills } from '@hachej/boring-agent/agents';

// Versioned skill folders: `<root>/<version>/<skill>/SKILL.md` plus `<root>/current` naming the version new conversations start
// on. A running conversation stays on its version until the person sends /reload-skill (the skills extension's native
// `reload_skill` tool). Driven through the real harness with a scripted model: the listing rendered into each request and the
// tool result the model receives. Fictional skills only.

const MAX_AGE = 100;
const settle = () => new Promise(resolve => setTimeout(resolve, MAX_AGE + 60));
const skillText = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'boring-versioned-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, text) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); };
  await write('skills/v1/letters/SKILL.md', skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic.'));
  await write('skills/v2/letters/SKILL.md', skillText('letters', 'Write a fictional letter in French', 'Sign as la Clinique Fictive.'));
  await write('skills/v2/invoices/SKILL.md', skillText('invoices', 'Draft a fictional invoice', 'Use the fictional rate card.'));
  return { root, env: new NodeExecutionEnv({ cwd: root }), write };
}

/** An agent over the versioned source; `ask(conversation, text)` runs one turn and returns what the model saw. */
async function agentOver(t, env, options = {}) {
  const seen = [];
  const scripted = createScriptedModel({ generic: [], script: {
    'which skills': [ctx => { seen.push({ system: ctx.system }); return 'Listed.'; }],
    '/reload-skill': [
      () => ({ tools: [{ name: 'reload_skill', args: {} }] }),
      ctx => { seen.push({ system: ctx.system, result: ctx.results[0]?.text }); return 'Reloaded.'; },
    ],
  } });
  const reports = [];
  const skills = liveSkills(directorySkillSource(env, 'skills', { versioned: true }), { name: 'fictional.skills', maxAgeMs: MAX_AGE, onDiagnostics: errors => reports.push(errors), ...options });
  const agent = defineAgent({ id: 'fictional-clerk', model: scripted.model, instructions: 'You file fictional letters.', extensions: [skills.extension] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: scripted.models }, context);
  t.after(() => harness.close(context).catch(() => {}));
  const ask = async (conversation, content) => {
    const done = await (await conversation.submit({ type: 'input', content }, context)).wait(context);
    assert.equal(done.status, 'done');
    return seen.at(-1);
  };
  return { open: () => agent.createConversation(harness, context), ask, reports, scripted, skills };
}

test('a running conversation stays on its version until /reload-skill; a new conversation starts on current', async t => {
  const { env, write } = await fixture(t);
  await write('skills/current', 'v1\n');
  const { open, ask, reports, scripted } = await agentOver(t, env);

  const running = await open();
  const first = (await ask(running, 'which skills')).system;
  assert.match(first, /- letters: Write a fictional letter\n|- letters: Write a fictional letter$/m);
  assert.doesNotMatch(first, /invoices/);
  assert.match(first, /\/reload-skill/, 'the listing tells the model what /reload-skill means');

  // Publish v2: the version folder is already written, flip `current`.
  await write('skills/current', 'v2\n');
  await settle();
  const stayed = (await ask(running, 'which skills')).system;
  assert.doesNotMatch(stayed, /invoices/, 'a running conversation keeps v1');
  assert.doesNotMatch(stayed, /in French/);

  const fresh = await open();
  const started = (await ask(fresh, 'which skills')).system;
  assert.match(started, /- invoices: Draft a fictional invoice/, 'a new conversation starts on v2');
  assert.match(started, /- letters: Write a fictional letter in French/);

  // /reload-skill moves the running conversation to v2; the request after the tool already lists v2.
  const reload = await ask(running, '/reload-skill');
  assert.match(reload.result, /version v2/);
  assert.match(reload.system, /- invoices: Draft a fictional invoice/);
  assert.match((await ask(running, 'which skills')).system, /- letters: Write a fictional letter in French/);

  // Rollback: write the old version back into `current`. Only new conversations and a reload move.
  await write('skills/current', 'v1');
  await settle();
  assert.match((await ask(running, 'which skills')).system, /invoices/, 'still on v2 until reloaded');
  assert.doesNotMatch((await ask(await open(), 'which skills')).system, /invoices/, 'a new conversation starts on v1 again');
  assert.match((await ask(running, '/reload-skill')).result, /version v1/);
  assert.doesNotMatch((await ask(running, 'which skills')).system, /invoices/);

  assert.ok(reports.every(errors => errors.length === 0), JSON.stringify(reports));
  assert.deepEqual(scripted.misses, []);
});

test('current naming a missing folder, or no readable current, gives a diagnostic and keeps the last good version', async t => {
  const { root, env, write } = await fixture(t);
  await write('skills/current', 'v2');
  const { open, ask, reports } = await agentOver(t, env);
  const running = await open();
  assert.match((await ask(running, 'which skills')).system, /- invoices:/);

  await write('skills/current', 'v3\n');
  await settle();
  assert.match((await ask(await open(), 'which skills')).system, /- invoices:/, 'a new conversation starts on the last good version');
  assert.ok(reports.at(-1).some(error => error.path === 'skills/current' && /v3/.test(error.message)), JSON.stringify(reports.at(-1)));
  const refused = (await ask(running, '/reload-skill')).result;
  assert.match(refused, /v2/);
  assert.match(refused, /v3/);

  await write('skills/current', '../v1');
  await settle();
  assert.match((await ask(await open(), 'which skills')).system, /- invoices:/, 'a pointer outside the root is refused');
  assert.ok(reports.at(-1).some(error => error.path === 'skills/current'));

  await rm(join(root, 'skills/current'));
  await settle();
  assert.match((await ask(await open(), 'which skills')).system, /- invoices:/, 'a missing pointer keeps the last good version');
  assert.ok(reports.at(-1).some(error => error.path === 'skills/current'));

  // Fixed: the next new conversation and a reload move again.
  await write('skills/current', 'v1');
  await settle();
  assert.doesNotMatch((await ask(await open(), 'which skills')).system, /invoices/);
  assert.match((await ask(running, '/reload-skill')).result, /version v1/);
  assert.deepEqual(reports.at(-1), []);
});

test('no good version yet: no skills and a diagnostic; refresh() moves conversations once current is published', async t => {
  const { env, write } = await fixture(t);
  const { open, ask, reports, skills } = await agentOver(t, env);
  const conversation = await open();
  assert.doesNotMatch((await ask(conversation, 'which skills')).system, /- letters:/);
  assert.ok(reports.at(-1).some(error => error.path === 'skills/current'));
  assert.equal(await skills.refresh(context), false);

  await write('skills/current', 'v1');
  assert.equal(await skills.refresh(context), true);
  assert.match((await ask(conversation, 'which skills')).system, /- letters: Write a fictional letter/);
  // A host's refresh() with a conversation id moves that conversation only.
  await write('skills/current', 'v2');
  await settle();
  const other = await open();
  assert.match((await ask(other, 'which skills')).system, /invoices/, 'a new conversation starts on v2');
  assert.doesNotMatch((await ask(conversation, 'which skills')).system, /invoices/, 'the running one stays on v1');
  assert.equal(await skills.refresh(context, undefined, conversation.id), true);
  assert.match((await ask(conversation, 'which skills')).system, /invoices/);
  await assert.rejects(skills.refresh(context, 'letters'), /whole versions/);
  assert.throws(() => liveSkills(directorySkillSource(env, 'skills', { versioned: true }), { name: 'x', onPublish: () => undefined }), /onPublish/);
});

test('defineAgent({ skills }) with a versioned source offers reload_skill', async t => {
  const { env, write } = await fixture(t);
  await write('skills/current', 'v1');
  const agent = defineAgent({ id: 'fictional-clerk', model: { provider: 'scripted', modelId: 'scripted' }, skills: directorySkillSource(env, 'skills', { versioned: true }) });
  assert.deepEqual(agent.extensions.flatMap(extension => extension.tools ?? []).map(tool => tool.name), ['load_skill', 'reload_skill']);
  const plain = defineAgent({ id: 'fictional-clerk', model: { provider: 'scripted', modelId: 'scripted' }, skills: directorySkillSource(env, 'skills') });
  assert.deepEqual(plain.extensions.flatMap(extension => extension.tools ?? []).map(tool => tool.name), ['load_skill'], 'a plain source has no reload_skill');
});
