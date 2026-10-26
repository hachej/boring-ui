import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFakeChatModel } from '@hachej/boring-testing/model';
import { createSkillsExtension, defineAgent, directorySkillSource, fileSkillSource, parseSkill } from '@hachej/boring-agent/agents';

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
