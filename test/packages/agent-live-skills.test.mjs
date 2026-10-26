import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFakeChatModel, createScriptedModel } from '@hachej/boring-testing/model';
import { createSkillsExtension, defineAgent, directorySkillSource, fileSkillSource, parseSkill } from '@hachej/boring-agent/agents';
import * as agents from '@hachej/boring-agent/agents';

// Live skills (D-313): a skills extension built on a source sees skills added, edited and removed after it started, once its
// cached copy is older than maxAgeMs. Driven through the real extension: the listing the harness renders into the model's
// request, and the extension's load_skill tool. Fictional skills only.

const MAX_AGE = 150;
const settle = () => new Promise(resolve => setTimeout(resolve, MAX_AGE + 60));
const skillText = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'boring-live-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, env: new NodeExecutionEnv({ cwd: root }) };
}

/** A conversation whose agent selects `extension`; `turn()` returns the rendered skills section of the next request. */
async function conversationWith(t, extension) {
  const fake = createFakeChatModel();
  const agent = defineAgent({ id: 'fictional-clerk', model: fake.model, instructions: 'You file fictional letters.', extensions: [extension] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: fake.models }, context);
  t.after(() => harness.close(context));
  const conversation = await agent.createConversation(harness, context);
  let turn = 0;
  return async () => {
    turn += 1;
    await conversation.submit({ type: 'input', requestId: `r${turn}`, content: `fictional request ${turn}` }, context);
    const call = await fake.nextCall();
    // Sections are patched in place across pi.system entries: replay them in order to get the text in effect now.
    let shown;
    for (const message of call.transcript.messages) {
      if (message.role !== 'system' || !message.sections || !('skills' in message.sections)) continue;
      shown = message.sections.skills ?? undefined;
    }
    call.respond('ok');
    await new Promise(resolve => setTimeout(resolve, 20));
    return shown ?? '';
  };
}

const loadSkill = extension => async name =>
  (await extension.tools.find(tool => tool.name === 'load_skill').execute({ name }, {}, context)).output[0].text;

test('a directory source: added, edited and removed skills reach the listing and load_skill after maxAgeMs', async t => {
  const { root, env } = await workspace(t);
  await mkdir(join(root, 'skills/letters'), { recursive: true });
  await writeFile(join(root, 'skills/letters/SKILL.md'), skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic.'));
  const reports = [];
  const extension = createSkillsExtension('fictional.skills', directorySkillSource(env, 'skills'), { maxAgeMs: MAX_AGE, onDiagnostics: errors => reports.push(errors) });
  const listing = await conversationWith(t, extension);
  const load = loadSkill(extension);

  assert.match(await listing(), /- letters: Write a fictional letter/);
  assert.match(await load('letters'), /^Sign as the Fictional Clinic\.\n\nThis skill's folder is `skills\/letters`/);

  // Added: invisible while the cached copy is fresh, visible once it is older than maxAgeMs.
  await mkdir(join(root, 'skills/invoices'), { recursive: true });
  await writeFile(join(root, 'skills/invoices/SKILL.md'), skillText('invoices', 'Draft a fictional invoice', 'Use the fictional rate card.'));
  assert.doesNotMatch(await listing(), /invoices/, 'the cached copy is kept until maxAgeMs');
  await settle();
  assert.match(await listing(), /- invoices: Draft a fictional invoice/);
  assert.match(await load('invoices'), /^Use the fictional rate card\./);

  // Edited.
  await writeFile(join(root, 'skills/letters/SKILL.md'), skillText('letters', 'Write a fictional letter in French', 'Sign as la Clinique Fictive, always.'));
  await settle();
  const edited = await listing();
  assert.match(edited, /- letters: Write a fictional letter in French/);
  assert.match(await load('letters'), /^Sign as la Clinique Fictive, always\./);

  // Removed.
  await rm(join(root, 'skills/invoices'), { recursive: true });
  await settle();
  assert.doesNotMatch(await listing(), /invoices/);
  assert.match(await load('invoices'), /Unknown skill "invoices"\. Available: letters/);

  // A broken SKILL.md is left out with its reason; the others keep working.
  await mkdir(join(root, 'skills/broken'), { recursive: true });
  await writeFile(join(root, 'skills/broken/SKILL.md'), 'no front matter here');
  await settle();
  const withBroken = await listing();
  assert.match(withBroken, /- letters:/);
  assert.doesNotMatch(withBroken, /broken/);
  assert.match(await load('broken'), /Skill "broken" could not be loaded \(skills\/broken\/SKILL\.md\): Skill needs front matter/);
  assert.deepEqual(reports.at(-1), [{ path: 'skills/broken/SKILL.md', name: 'broken', message: 'Skill needs front matter with name and description' }]);

  // A second folder declaring an existing name is skipped as a duplicate.
  await mkdir(join(root, 'skills/letters-copy'), { recursive: true });
  await writeFile(join(root, 'skills/letters-copy/SKILL.md'), skillText('letters', 'A copy', 'Copied body.'));
  await settle();
  assert.match(await load('letters'), /^Sign as la Clinique Fictive/);
  assert.ok(reports.at(-1).some(error => error.path === 'skills/letters-copy/SKILL.md' && /Duplicate skill: letters/.test(error.message)));
});

test('a file source: one skill file added, edited, broken and removed', async t => {
  const { root, env } = await workspace(t);
  const reports = [];
  const extension = createSkillsExtension('fictional.skill', fileSkillSource(env, 'notes/triage.md'), { maxAgeMs: MAX_AGE, onDiagnostics: errors => reports.push(errors) });
  const listing = await conversationWith(t, extension);
  const load = loadSkill(extension);

  assert.doesNotMatch(await listing(), /triage/, 'a missing file offers no skill');
  await mkdir(join(root, 'notes'), { recursive: true });
  await writeFile(join(root, 'notes/triage.md'), skillText('triage', 'Sort fictional requests', 'Urgent first.'));
  await settle();
  assert.match(await listing(), /- triage: Sort fictional requests/);
  assert.match(await load('triage'), /^Urgent first\.\n\nThis skill's folder is `notes`/);

  await writeFile(join(root, 'notes/triage.md'), skillText('triage', 'Sort fictional requests by date', 'Oldest first, then urgent.'));
  await settle();
  assert.match(await listing(), /- triage: Sort fictional requests by date/);
  assert.match(await load('triage'), /^Oldest first, then urgent\./);

  await writeFile(join(root, 'notes/triage.md'), '---\nname: Not A Valid Name\ndescription: x\n---\nbody\n');
  await settle();
  assert.doesNotMatch(await listing(), /triage/);
  assert.match(await load('triage'), /Skill "triage" could not be loaded \(notes\/triage\.md\): Invalid skill name: Not A Valid Name/);
  assert.equal(reports.at(-1)[0].path, 'notes/triage.md');

  await rm(join(root, 'notes/triage.md'));
  await settle();
  assert.doesNotMatch(await listing(), /triage/);
  assert.match(await load('triage'), /Unknown skill "triage"/);
  assert.deepEqual(reports.at(-1), []);
});

test('a static array keeps its snapshot and its errors', async () => {
  const skill = parseSkill(skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic.'));
  assert.throws(() => createSkillsExtension('x', [skill, skill]), /Duplicate skill/);
  const extension = createSkillsExtension('fictional.static', [skill]);
  assert.match(await extension.sections[0].render({}, context), /- letters: Write a fictional letter/);
  assert.equal(await loadSkill(extension)('letters'), 'Sign as the Fictional Clinic.');
});

// Skills control (D-315, reshaped by D-318): a per-conversation `visible` filter, `companionFiles` beside SKILL.md, a `refresh` handle and an
// `onPublish` veto. Driven through the real extension: the section Pi renders into the model's system prompt and load_skill
// calls the model makes, so Pi passes its own conversation id, validates the arguments and runs the tool.

/** Each `ask(calls)` is one turn of a new conversation: the model calls load_skill with each of `calls`, in order. */
async function scriptedHarness(t, extension) {
  const turns = [];
  const scripted = createScriptedModel({ script: { 'use the fictional skills': [
    ctx => ({ tools: turns.at(-1).calls.map(args => ({ name: 'load_skill', args })) }),
    ctx => { turns.at(-1).system = ctx.system; turns.at(-1).results = ctx.results.map(result => result.text); return 'Done.'; },
  ] } });
  const agent = defineAgent({ id: 'fictional-clerk', model: scripted.model, instructions: 'You file fictional letters.', extensions: [extension] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: scripted.models }, context);
  t.after(() => harness.close(context).catch(() => {}));
  return {
    open: () => agent.createConversation(harness, context),
    ask: async (conversation, calls) => {
      turns.push({ calls });
      const submission = await conversation.submit({ type: 'input', content: 'use the fictional skills' }, context);
      assert.equal((await submission.wait(context)).status, 'done');
      assert.deepEqual(scripted.misses, []);
      return turns.at(-1);
    },
  };
}

async function skillsFolder(root, skills) {
  for (const [folder, text] of Object.entries(skills)) {
    await mkdir(join(root, 'skills', folder), { recursive: true });
    await writeFile(join(root, 'skills', folder, 'SKILL.md'), text);
  }
}

test('visible: each conversation sees only its skills, and a hidden skill answers exactly like an unknown one', async t => {
  const { root, env } = await workspace(t);
  await skillsFolder(root, {
    letters: skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic.'),
    invoices: skillText('invoices', 'Draft a fictional invoice', 'Use the fictional rate card.'),
    broken: 'no front matter here',
  });
  let billing;
  const asked = [];
  const extension = createSkillsExtension('fictional.skills', directorySkillSource(env, 'skills'), {
    visible: async (conversationId, skills) => {
      asked.push([conversationId, skills.map(skill => skill.name)]);
      return conversationId === billing.id ? skills : skills.filter(skill => skill.name !== 'invoices');
    },
  });
  const { open, ask } = await scriptedHarness(t, extension);
  billing = await open();
  const clerk = await open();
  const calls = [{ name: 'invoices' }, { name: 'nonexistent' }, { name: 'broken' }];

  const billed = await ask(billing, calls);
  assert.match(billed.system, /- invoices: Draft a fictional invoice/);
  assert.match(billed.results[0], /^Use the fictional rate card\./);

  const clerked = await ask(clerk, calls);
  assert.match(clerked.system, /- letters: Write a fictional letter/);
  assert.doesNotMatch(clerked.system, /invoices/);
  assert.equal(clerked.results[1], 'Unknown skill "nonexistent". Available: letters');
  assert.equal(clerked.results[0], 'Unknown skill "invoices". Available: letters', 'hidden: the same answer as an unknown skill');
  assert.equal(clerked.results[2], 'Unknown skill "broken". Available: letters', 'with a filter, an unreadable skill does not reveal itself either');
  // One call per listing and per load_skill, with Pi's conversation id and the whole valid list (never the unreadable one).
  assert.ok(asked.some(([id]) => id === clerk.id), 'the filter gets the conversation id from Pi');
  for (const [, names] of asked) assert.deepEqual(names, ['invoices', 'letters']);
});

test('companionFiles: checked when the listing is read, listed by load_skill and read on demand, never outside the folder', async t => {
  const { root, env } = await workspace(t);
  await skillsFolder(root, { letters: skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic. See references/tone.md.') });
  await mkdir(join(root, 'skills/letters/references'), { recursive: true });
  await mkdir(join(root, 'skills/letters/scripts'), { recursive: true });
  await writeFile(join(root, 'skills/letters/references/tone.md'), 'Warm and fictional.\n');
  await writeFile(join(root, 'skills/letters/scripts/sign.sh'), 'echo fictional-signature\n');
  await writeFile(join(root, 'outside.txt'), 'fictional text outside the skill\n');
  await symlink(join(root, 'outside.txt'), join(root, 'skills/letters/link.md'));
  await writeFile(join(root, 'skills/letters/references/logo.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]));
  const reports = [];
  const extension = createSkillsExtension('fictional.skills', directorySkillSource(env, 'skills'), { companionFiles: true, onDiagnostics: errors => reports.push(errors) });
  // The bad files are found when the listing is read, before any load_skill call.
  assert.match(await extension.sections[0].render({}, context), /- letters: Write a fictional letter/);
  assert.deepEqual(reports, [[
    { path: 'skills/letters/link.md', name: 'letters', message: 'Companion file left out: a symbolic link' },
    { path: 'skills/letters/references/logo.bin', name: 'letters', message: 'Companion file left out: not UTF-8 text' },
  ]]);
  const { open, ask } = await scriptedHarness(t, extension);
  const turn = await ask(await open(), [
    { name: 'letters' },
    { name: 'letters', path: 'references/tone.md' },
    { name: 'letters', path: './scripts/sign.sh' },
    { name: 'letters', path: '../../outside.txt' },
    { name: 'letters', path: 'link.md' },
    { name: 'letters', path: 'references/logo.bin' },
  ]);
  assert.match(turn.system, /- letters: Write a fictional letter/);
  const [loaded, tone, sign, escaped, linked, binary] = turn.results;
  assert.match(loaded, /^Sign as the Fictional Clinic\./);
  assert.match(loaded, /Companion files of this skill \(read one with load_skill and its path\):\n- references\/tone\.md\n- scripts\/sign\.sh$/);
  assert.equal(tone, 'Warm and fictional.\n');
  assert.equal(sign, 'echo fictional-signature\n');
  for (const refused of [escaped, linked, binary]) {
    assert.match(refused, /^Skill "letters" has no companion file ".*"\. Companion files: references\/tone\.md, scripts\/sign\.sh$/);
    assert.doesNotMatch(refused, /fictional text outside/);
  }
  // An array has no FileSystem to read companions through.
  assert.throws(() => createSkillsExtension('x', [parseSkill(skillText('letters', 'x', 'y'))], { companionFiles: true }), /companionFiles/);
});

test('refresh: the host re-reads the source now, one skill or all, without waiting for maxAgeMs', async t => {
  const { root, env } = await workspace(t);
  await skillsFolder(root, { letters: skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic.') });
  const controller = agents.createSkillsController('fictional.skills', directorySkillSource(env, 'skills'), { maxAgeMs: 60_000 });
  const listing = await conversationWith(t, controller.extension);
  const load = loadSkill(controller.extension);
  assert.match(await listing(), /- letters: Write a fictional letter$/m);

  await skillsFolder(root, {
    invoices: skillText('invoices', 'Draft a fictional invoice', 'Use the fictional rate card.'),
    letters: skillText('letters', 'Write a fictional letter in French', 'Sign as la Clinique Fictive.'),
  });
  assert.doesNotMatch(await listing(), /invoices/, 'the cached copy is kept for maxAgeMs');

  assert.equal(await controller.refresh(context, 'invoices'), true);
  const one = await listing();
  assert.match(one, /- invoices: Draft a fictional invoice/);
  assert.match(one, /- letters: Write a fictional letter$/m, 'refreshing one skill leaves the others as they were');
  assert.match(await load('letters'), /^Sign as the Fictional Clinic\./);

  assert.equal(await controller.refresh(context), true);
  assert.match(await listing(), /- letters: Write a fictional letter in French/);
  assert.match(await load('letters'), /^Sign as la Clinique Fictive\./);

  await rm(join(root, 'skills/invoices'), { recursive: true });
  await controller.refresh(context, 'invoices');
  assert.doesNotMatch(await listing(), /invoices/);
  assert.match(await load('invoices'), /^Unknown skill "invoices"/);
});

test('onPublish: a refused listing never replaces the current one, and the reason goes to onDiagnostics', async t => {
  const { root, env } = await workspace(t);
  await skillsFolder(root, { letters: skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic.') });
  const reports = [], published = [];
  const names = skills => skills.map(skill => `${skill.name}: ${skill.description}`);
  const controller = agents.createSkillsController('fictional.skills', directorySkillSource(env, 'skills'), {
    maxAgeMs: MAX_AGE,
    onDiagnostics: errors => reports.push(errors),
    onPublish: async (next, previous) => {
      published.push([names(next), names(previous)]);
      await new Promise(resolve => setTimeout(resolve, 5));
      if (next.some(skill => /unreviewed/.test(skill.body))) return 'fictional review refused an unreviewed body';
      if (next.some(skill => /throws/.test(skill.body))) throw new Error('fictional reviewer failed');
    },
  });
  const listing = await conversationWith(t, controller.extension);
  const load = loadSkill(controller.extension);
  assert.match(await listing(), /- letters: Write a fictional letter$/m);
  assert.deepEqual(published, [[['letters: Write a fictional letter'], []]]);

  await skillsFolder(root, { letters: skillText('letters', 'Write a fictional letter fast', 'An unreviewed body.') });
  await settle();
  assert.match(await listing(), /- letters: Write a fictional letter$/m, 'the previous listing stays');
  assert.match(await load('letters'), /^Sign as the Fictional Clinic\./);
  assert.deepEqual(published.at(-1), [['letters: Write a fictional letter fast'], ['letters: Write a fictional letter']]);
  assert.deepEqual(reports.at(-1), [{ path: '', message: 'Listing refused by onPublish: fictional review refused an unreviewed body' }]);

  await skillsFolder(root, { letters: skillText('letters', 'Write a fictional letter, maybe', 'This one throws.') });
  assert.equal(await controller.refresh(context), false);
  assert.match(await load('letters'), /^Sign as the Fictional Clinic\./);
  assert.match(reports.at(-1)[0].message, /^Listing refused by onPublish: fictional reviewer failed$/);

  await skillsFolder(root, { letters: skillText('letters', 'Write a reviewed fictional letter', 'Sign as the Reviewed Clinic.') });
  assert.equal(await controller.refresh(context), true);
  assert.match(await listing(), /- letters: Write a reviewed fictional letter/);
  assert.match(await load('letters'), /^Sign as the Reviewed Clinic\./);
  assert.deepEqual(reports.at(-1), []);
});

// Skills reshape (D-318): a load_skill miss checks the source now, and the listing intro can be replaced.

test('refresh on miss: load_skill for a name not listed checks the source once now, whatever maxAgeMs, through onPublish', async t => {
  const { root, env } = await workspace(t);
  await skillsFolder(root, { letters: skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic.') });
  const source = directorySkillSource(env, 'skills'), counts = { version: 0, list: 0 }, published = [];
  const counted = {
    fs: source.fs,
    version: async ctx => { counts.version += 1; await new Promise(resolve => setTimeout(resolve, 10)); return source.version(ctx); },
    list: async ctx => { counts.list += 1; return source.list(ctx); },
  };
  const extension = createSkillsExtension('fictional.skills', counted, {
    maxAgeMs: 60_000,
    onPublish: next => { published.push(next.map(skill => skill.name)); },
  });
  const { open, ask } = await scriptedHarness(t, extension);
  const conversation = await open();
  assert.match((await ask(conversation, [{ name: 'letters' }])).results[0], /^Sign as the Fictional Clinic\./);
  assert.deepEqual(counts, { version: 1, list: 1 });

  // A model asking for names that do not exist: each miss checks version() (concurrent misses share one check), and the
  // source is listed again only when it changed.
  const misses = await ask(conversation, [{ name: 'nonexistent' }, { name: 'also-missing' }, { name: 'nope' }]);
  for (const [index, name] of ['nonexistent', 'also-missing', 'nope'].entries()) assert.equal(misses.results[index], `Unknown skill "${name}". Available: letters`);
  assert.ok(counts.version >= 2 && counts.version <= 4, `one version() per miss at most, got ${counts.version}`);
  assert.equal(counts.list, 1, 'an unchanged source is not listed again');

  // Added after the listing was read, well inside maxAgeMs: the miss finds it, through onPublish.
  await skillsFolder(root, { invoices: skillText('invoices', 'Draft a fictional invoice', 'Use the fictional rate card.') });
  const found = await ask(conversation, [{ name: 'invoices' }]);
  assert.match(found.results[0], /^Use the fictional rate card\./);
  assert.match(found.system, /- invoices: Draft a fictional invoice/, 'the listing shows it from the next request on');
  assert.equal(counts.list, 2);
  assert.deepEqual(published.at(-1), ['invoices', 'letters']);
});

test('intro: replaces the text before the skill lines; the default is unchanged', async t => {
  const skill = parseSkill(skillText('letters', 'Write a fictional letter', 'Sign as the Fictional Clinic.'));
  const listing = await conversationWith(t, createSkillsExtension('fictional.intro', [skill], { intro: 'Fictional clinic skills, load one first:' }));
  assert.equal(await listing(), '<skills>\nFictional clinic skills, load one first:\n- letters: Write a fictional letter\n</skills>');
  const plain = await createSkillsExtension('fictional.plain', [skill]).sections[0].render({}, context);
  assert.match(plain, /^Before starting a task that matches a skill, call load_skill with its name .*\/<skill-name>.*\n- letters: Write a fictional letter$/);
});
