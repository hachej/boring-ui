import assert from 'node:assert/strict';
import test from 'node:test';
import { targetBlock, targetContent, withoutTarget } from '@hachej/boring-ui-kit/chat-view';
import { messageText } from '@hachej/boring-agent/conversations';
// The agent's own strict stripper has no public export (conversations.ts and struggle.ts use it internally, and only the title path is public,
// which is deliberately more conservative). So this contract test imports the built file by relative path to guard it against the kit.
import { withoutTarget as agentWithoutTarget } from '../../packages/agent/dist/target-block.js';

// D-1224: the <target> block (point-and-speak) has one grammar. The kit owns it; packages/agent keeps one local strict stripper
// (it has only a type edge to ui). This table runs through both strict strippers (the kit's and the agent's) so they cannot drift, and
// through the agent's conversation title path (`messageText`), which is intentionally more conservative: text starting with `<target>` that
// is not a valid block never becomes a title (no closing tag gives nothing; a closing tag gives what follows, trimmed). Fictional fixtures only.
const SPEECH = 'un yaourt grec';
const pad = size => JSON.stringify({ note: 'x'.repeat(size - '{"note":""}'.length) });
const atCap = pad(1024), overCap = pad(1025);
assert.equal(new TextEncoder().encode(atCap).length, 1024);
assert.equal(new TextEncoder().encode(overCap).length, 1025);
// [text, said, chip, title]: an invalid block is plain text for the strippers, but its title is the conservative value.
const invalid = (text, title) => [text, text, false, title];

// [name, message text, what the person said (kit and agent strippers), whether a chip shows, the expected title]
const cases = [
  ['a valid block', `<target>{"meal":"m-fictional-42"}</target>\n\n${SPEECH}`, SPEECH, true, SPEECH],
  ['exactly at the cap', `<target>${atCap}</target>\n\n${SPEECH}`, SPEECH, true, SPEECH],
  ['over the cap', ...invalid(`<target>${overCap}</target>\n\n${SPEECH}`, SPEECH)],
  ['no blank line after it', ...invalid(`<target>{"meal":"m-fictional-42"}</target>${SPEECH}`, SPEECH)],
  ['one newline only', ...invalid(`<target>{"meal":"m-fictional-42"}</target>\n${SPEECH}`, SPEECH)],
  ['not JSON', ...invalid(`<target>not json</target>\n\n${SPEECH}`, SPEECH)],
  ['JSON but not an object', ...invalid(`<target>[1,2]</target>\n\n${SPEECH}`, SPEECH)],
  ['never closed', ...invalid(`<target>{"meal":"m-fictional-42"}\n\n${SPEECH}`, undefined)],
  ['a < in the payload (escaped by the builder)', `${targetBlock({ meal: 'm</target><target>' })}\n\n${SPEECH}`, SPEECH, true, SPEECH],
  ['a raw </target> inside the payload', ...invalid(`<target>{"meal":"m</target>x"}</target>\n\n${SPEECH}`, `x"}</target>\n\n${SPEECH}`)],
  ['no block at all', SPEECH, SPEECH, false, SPEECH],
];

for (const [name, text, said, chip, title] of cases) {
  const person = text => ({ role: 'user', content: text, timestamp: 1 });
  test(`<target> grammar: ${name}`, () => {
    assert.equal(withoutTarget(text), said, 'kit stripper');
    assert.equal(agentWithoutTarget(text), said, 'agent strict stripper agrees with the kit');
    assert.equal(targetContent(text) !== undefined, chip, 'kit chip');
    assert.equal(messageText(person(text)), title, 'agent title path');
    assert.equal(messageText(person([{ type: 'text', text }])), title, 'same for text parts');
  });
}

test('targetBlock round trips through targetContent, withoutTarget and the agent title path', () => {
  const target = { label: 'Lunch', meal: 'm-fictional-42', slot: { name: 'lunch' } };
  const text = `${targetBlock(target)}\n\n${SPEECH}`;
  assert.deepEqual(targetContent(text)?.target, target);
  assert.equal(targetContent(text)?.speech, SPEECH);
  assert.equal(withoutTarget(text), SPEECH);
  assert.equal(messageText({ role: 'user', content: text, timestamp: 1 }), SPEECH);
});

test('targetBlock escapes < and refuses a payload over the cap', () => {
  const block = targetBlock({ meal: 'm</target><target>' });
  assert.ok(block?.startsWith('<target>') && block.endsWith('</target>'));
  assert.equal(block.slice(8, -9).includes('<'), false, 'no raw < inside the payload');
  assert.notEqual(targetBlock(JSON.parse(atCap)), undefined, 'exactly at the cap');
  assert.equal(targetBlock(JSON.parse(overCap)), undefined, 'over the cap');
  assert.equal(targetBlock({ note: '<'.repeat(200) }), undefined, 'the cap counts the escaped payload (6 bytes per <)');
});
