import assert from 'node:assert/strict';
import test from 'node:test';
import { targetBlock, targetContent, withoutTarget } from '@hachej/boring-ui-kit/chat-view';
import { messageText } from '@hachej/boring-agent/conversations';

// D-1224: the <target> block (point-and-speak) has one grammar. The kit owns it; packages/agent keeps one local strict stripper
// (it has only a type edge to ui). This table runs through the kit's stripper and through the agent's conversation title path
// (`messageText`, which titles, previews and adoption use) so the two cannot drift. Fictional fixtures only.
const SPEECH = 'un yaourt grec';
const pad = size => JSON.stringify({ note: 'x'.repeat(size - '{"note":""}'.length) });
const atCap = pad(1024), overCap = pad(1025);
assert.equal(new TextEncoder().encode(atCap).length, 1024);
assert.equal(new TextEncoder().encode(overCap).length, 1025);
const plain = text => [text, text, false];

// [name, message text, what the person said, whether a chip shows]
const cases = [
  ['a valid block', `<target>{"meal":"m-fictional-42"}</target>\n\n${SPEECH}`, SPEECH, true],
  ['exactly at the cap', `<target>${atCap}</target>\n\n${SPEECH}`, SPEECH, true],
  ['over the cap', ...plain(`<target>${overCap}</target>\n\n${SPEECH}`)],
  ['no blank line after it', ...plain(`<target>{"meal":"m-fictional-42"}</target>${SPEECH}`)],
  ['one newline only', ...plain(`<target>{"meal":"m-fictional-42"}</target>\n${SPEECH}`)],
  ['not JSON', ...plain(`<target>not json</target>\n\n${SPEECH}`)],
  ['JSON but not an object', ...plain(`<target>[1,2]</target>\n\n${SPEECH}`)],
  ['never closed', ...plain(`<target>{"meal":"m-fictional-42"}\n\n${SPEECH}`)],
  ['a < in the payload (escaped by the builder)', `${targetBlock({ meal: 'm</target><target>' })}\n\n${SPEECH}`, SPEECH, true],
  ['a raw </target> inside the payload', ...plain(`<target>{"meal":"m</target>x"}</target>\n\n${SPEECH}`)],
  ['no block at all', ...plain(SPEECH)],
];

for (const [name, text, said, chip] of cases) {
  const person = text => ({ role: 'user', content: text, timestamp: 1 });
  test(`<target> grammar: ${name}`, () => {
    assert.equal(withoutTarget(text), said, 'kit stripper');
    assert.equal(targetContent(text) !== undefined, chip, 'kit chip');
    assert.equal(messageText(person(text)), said.trim() || undefined, 'agent title path agrees with the kit');
    assert.equal(messageText(person([{ type: 'text', text }])), said.trim() || undefined, 'same for text parts');
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
