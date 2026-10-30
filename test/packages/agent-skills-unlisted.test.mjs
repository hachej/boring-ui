// D-564: `skillInFolder` is public, and `loadUnlisted` lets the host answer `load_skill` for a skill kept out of the listing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { parseSkill, skillInFolder, staticSkills } from '@hachej/boring-agent/agents';

const skill = (name, body = `Body of ${name}.`) => parseSkill(`---\nname: ${name}\ndescription: Fictional ${name}.\n---\n${body}`);
const listed = skill('listed');

function open(options) {
  const { extension } = staticSkills([listed], { name: 'fictional.skills', ...options });
  const tool = extension.tools.find(each => each.name === 'load_skill');
  const section = extension.sections.find(each => each.key === 'skills');
  return {
    load: async (name, conversationId = 7) => (await tool.execute({ name }, { conversationId }, context)).output[0].text,
    listing: (conversationId = 7) => section.render({ conversationId }, context),
  };
}

test('loadUnlisted answers for a name out of the listing, with the conversation id; the listing never shows it', async () => {
  const calls = [];
  const { load, listing } = open({ loadUnlisted: (conversationId, name) => { calls.push([conversationId, name]); return name === 'secret' ? skill('secret') : undefined; } });
  assert.match(await load('secret'), /Body of secret/);
  assert.deepEqual(calls, [[7, 'secret']]);
  assert.doesNotMatch(await listing(), /secret/);
});

test('a listed skill never asks the hook; unknown, foreign, invalid and throwing answers read as unknown', async () => {
  let asked = 0;
  assert.match(await open({ loadUnlisted: () => { asked++; } }).load('listed'), /Body of listed/);
  assert.equal(asked, 0);
  assert.match(await open({ loadUnlisted: () => undefined }).load('nope'), /Unknown skill "nope"/);
  assert.match(await open({ loadUnlisted: () => skill('other') }).load('nope'), /Unknown skill "nope"/);
  assert.match(await open({ loadUnlisted: () => ({ name: 'nope', description: '', body: '' }) }).load('nope'), /Unknown skill "nope"/);
  assert.match(await open({ loadUnlisted: () => { throw new Error('fictional store down'); } }).load('nope'), /Unknown skill "nope"/);
});

test('a name that is not a valid skill name never reaches the host', async () => {
  let asked = 0;
  const { load } = open({ loadUnlisted: () => { asked++; } });
  assert.match(await load('../../etc/passwd'), /Unknown skill/);
  assert.equal(asked, 0);
});

test('it wins over visible: the hook is the host\'s own check', async () => {
  const { load } = open({ visible: () => [], loadUnlisted: (_id, name) => skill(name) });
  assert.match(await load('listed'), /Body of listed/);
});

test('skillInFolder is public: load_skill names the folder of an unlisted skill', async () => {
  const { load } = open({ loadUnlisted: () => skillInFolder(skill('secret'), 'fictional/skills/secret') });
  assert.match(await load('secret'), /This skill's folder is `fictional\/skills\/secret`/);
});
