import assert from 'node:assert/strict';
import test from 'node:test';
import { appendToDraft, displayName, fileKind, hasMention, isLongPaste, isVoicePath, kindMentionDraft, looksLikeMarkdown, mentionedPaths, mentionKind, mentionToken, mentionTrigger, pieces, prependToDraft, removeMention, slashGroup, slashItems, slashQuery, visibleParts, withoutKindMentions, withoutMentions, writeKindMentionDraft } from '@hachej/boring-ui-kit/chat-text';
import { memberMention } from '@hachej/boring-ui-kit/shared-chat';
import { mentionedPaths as agentMentionedPaths } from '@hachej/boring-agent/mentions';

// The published chat-text subpath: the one text grammar of the chat surfaces, with fictional values only.
test('appendToDraft adds a space only between non-empty text not already ending in whitespace', () => {
  for (const [draft, text, expected] of [['', 'hi', 'hi'], ['Hello', 'there', 'Hello there'], ['Hello ', 'there', 'Hello there'], ['Hello\n', 'there', 'Hello\nthere'], ['Hello', '', 'Hello ']]) {
    assert.equal(appendToDraft(draft, text), expected, JSON.stringify([draft, text]));
  }
  assert.equal(prependToDraft('later draft', 'refused'), 'refused\nlater draft');
  assert.equal(prependToDraft('  ', 'refused'), 'refused');
  assert.equal(prependToDraft('draft', ' \n'), 'draft');
});

test('a mention token is bare for a plain value and quoted for whitespace, a quote or a backslash', () => {
  assert.equal(mentionToken('docs/plan.md'), '@docs/plan.md');
  assert.equal(mentionToken('docs/Meeting notes.md'), '@"docs/Meeting notes.md"');
  assert.equal(mentionToken('say "hi".md'), '@"say \\"hi\\".md"');
  assert.equal(mentionToken('team\\leo'), '@"team\\\\leo"');
  for (const value of ['docs/plan.md', 'docs/Meeting notes.md', 'say "hi".md', 'team\\leo']) {
    assert.deepEqual(mentionedPaths(`see ${mentionToken(value)}, then`), [value], value);
    assert.equal(memberMention({ id: value, name: 'Fictional', kind: 'person' }), mentionToken(value), 'shared-chat writes the same token');
    const draft = `before ${mentionToken(value)} after`;
    assert.equal(hasMention(draft, value), true);
    assert.equal(removeMention(draft, value), 'before after');
  }
});

test('the kit parser agrees with the agent package mention resolver', () => {
  const texts = ['', 'no mention', '@a.md', 'see @docs/a.md, and @b/c.txt.', 'mail me@x.com @ok', '(@paren) @q? @"quoted"', '@a @a @b', 'line\n@next\t@tab', '@', '@.', '@a/b!', 'x@y @z)', '/skill @file.md',
    '@"docs/Meeting notes.md" and @docs/plan.md.', '@"say \\"hi\\".md" @"a\\\\ b" @"unterminated', '@"" @"  "x', '@"a b"c @"tail', '@"team\\\\leo"'];
  for (const text of texts) {
    assert.deepEqual(mentionedPaths(text), agentMentionedPaths(text), JSON.stringify(text));
    assert.deepEqual([...new Set(pieces(text, { mentions: true, skills: [] }).filter(piece => piece.kind === 'mention').map(piece => piece.value))], agentMentionedPaths(text), JSON.stringify(text));
  }
});

test('app kind tokens share the public mention grammar without matching a prefix of another mention', () => {
  const kind = { label: path => path }, config = { kinds: { repas: kind } };
  assert.deepEqual(mentionKind('repas:2026-10-27/dejeuner', config), { kind, path: '2026-10-27/dejeuner' });
  assert.equal(mentionKind('unknown:meal', config), undefined);
  assert.equal(mentionKind('toString:meal', config), undefined);
  assert.equal(hasMention('@repas:meal-long', 'repas:meal'), false);
  assert.equal(removeMention('@repas:meal-long', 'repas:meal'), '@repas:meal-long');
  assert.equal(removeMention('before @repas:meal after', 'repas:meal'), 'before after');
  const quoted = mentionToken('repas:Meeting "notes"\\fictional');
  assert.equal(hasMention(quoted, 'repas:Meeting "notes"\\fictional'), true);
  assert.equal(removeMention(quoted, 'repas:Meeting "notes"\\fictional'), '');
});

test('kind mention draft projects only app tokens and keeps editable spacing and files', () => {
  const config = { kinds: { repas: {} } };
  assert.deepEqual(kindMentionDraft('@repas:meal ', config), { text: '', tokens: ['@repas:meal'] });
  assert.deepEqual(kindMentionDraft('@repas:meal my words @docs/plan.md', config), { text: 'my words @docs/plan.md', tokens: ['@repas:meal'] });
  for (const text of ['my words', 'my words ', 'my words  ', '', '😀 café\nnext']) {
    const raw = `${text}${text ? ' ' : ''}@repas:meal @repas:dinner`;
    assert.equal(kindMentionDraft(raw, config).text, text);
  }
  assert.deepEqual(kindMentionDraft('@docs/plan.md ', config), { text: '@docs/plan.md ', tokens: [] });
  const token = mentionToken('repas:Meeting "notes"');
  assert.deepEqual(kindMentionDraft(`${token} words`, config), { text: 'words', tokens: [token] });
});

test('hidden kind serialization prefixes complete tokens before unfinished quoted editable input', () => {
  const config = { kinds: { repas: {} } }, token = mentionToken('repas:Meeting notes');
  for (const text of ['@"', '@"unfinished', 'my words ', '😀 café\nnext', '']) {
    const raw = writeKindMentionDraft(text, [token]);
    assert.deepEqual(kindMentionDraft(raw, config), { text, tokens: [token] });
    assert.ok(mentionedPaths(raw).includes('repas:Meeting notes'));
  }
  assert.equal(writeKindMentionDraft('ordinary @docs/plan.md', []), 'ordinary @docs/plan.md');
});

test('voice consumption removes every mention while refused text drops only registered kinds', () => {
  const config = { kinds: { repas: {} } };
  assert.equal(withoutMentions('@repas:meal @repas:meal @docs/plan.md @docs/plan.md '), '');
  assert.equal(withoutMentions('@repas:meal @repas:meal my words @docs/plan.md'), 'my words');
  assert.equal(withoutKindMentions('@repas:meal @repas:meal my words @docs/plan.md', config), 'my words @docs/plan.md');
  assert.equal(withoutKindMentions('@unknown:meal my words', config), '@unknown:meal my words');
});

test('slash, mention triggers, pieces and file rules', () => {
  assert.equal(slashQuery('/rev', 4), 'rev');
  assert.equal(slashQuery('a /rev', 6), null);
  assert.deepEqual(mentionTrigger('see @"Meet', 10), { query: 'Meet', start: 4, end: 10 });
  assert.deepEqual(slashItems({ commands: [{ name: 'clear', sourcePlugin: 'core' }], skills: [{ name: 'review', description: 'Fictional' }] }).map(item => [item.name, item.source, slashGroup(item)]), [['clear', 'local', 'core'], ['review', 'skill', 'skills']]);
  assert.deepEqual(pieces('/review @a.md now', { mentions: true, skills: ['review'] }).map(piece => piece.kind ?? 'text'), ['skill', 'text', 'mention', 'text']);
  assert.deepEqual(visibleParts(pieces('@uploads/x.png hello', { mentions: true, skills: [] }), piece => piece.kind === 'mention'), [{ text: 'hello' }]);
  assert.equal(fileKind('a/B.PDF'), 'pdf');
  assert.equal(isVoicePath('uploads/voice-1.webm'), true);
  assert.equal(isVoicePath('uploads/song.webm'), false);
  assert.equal(displayName('uploads/report-1a2b3c4d.pdf'), 'report.pdf');
  assert.equal(isLongPaste('x'.repeat(2001)), true);
  assert.equal(isLongPaste('short'), false);
  assert.equal(looksLikeMarkdown('# Title'), true);
  assert.equal(looksLikeMarkdown('plain words'), false);
});
