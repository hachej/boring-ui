// The board@1 format (registry/board-viewer/board.ts) through its public functions: the strict parser and its versions, the planner over the
// fictional fixtures in test/fixtures/board, and the edit round-trip (frame moves and notes written back as board@1). No canvas runs here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/board-format-test');
mkdirSync(out, { recursive: true });
await build({ entryPoints: [join(root, 'registry/board-viewer/board.ts')], outfile: join(out, 'board.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const board = await import(pathToFileURL(join(out, 'board.mjs')).href);

const fixture = name => readFileSync(join(root, 'test/fixtures/board', name), 'utf8');
const BOARD = fixture('booking.board.json');
const files = new Map([
  ['booking.maquette.json', fixture('booking.maquette.json')],
  ['confirm.mockup.html', fixture('confirm.mockup.html')],
]);
const parsedBoard = () => {
  const parsed = board.parseBoard(BOARD);
  assert.equal(parsed.kind, 'ok', JSON.stringify(parsed));
  return parsed.board;
};
const invalidIssues = text => {
  const parsed = board.parseBoard(text);
  assert.equal(parsed.kind, 'invalid', `expected invalid, got ${JSON.stringify(parsed)}`);
  return parsed.issues;
};
const withItems = items => JSON.stringify({ format: 'board@1', items });

test('the fixture board parses to board@1 with its items, links and layout', () => {
  const parsed = parsedBoard();
  assert.equal(parsed.format, 'board@1');
  assert.equal(parsed.title, 'Session booking, v1');
  assert.deepEqual(parsed.items.map(item => item.id), ['booking', 'confirm-html', 'note-1']);
  assert.deepEqual(parsed.links, [{ from: 'booking/confirmed', to: 'confirm-html', label: 'richer version' }]);
  assert.deepEqual(parsed.layout, { 'booking/sessions': { x: 0, y: 267 } });
});

test('an unversioned board is invalid, with the fix named', () => {
  const issues = invalidIssues(JSON.stringify({ items: [] }));
  assert.deepEqual(issues.map(issue => issue.path), ['format']);
  assert.match(issues[0].message, /missing.*"format": "board@1"/);
});

test('a board of another format or a malformed version is invalid, not guessed', () => {
  for (const format of ['maquette@1', 'board', 'board@', 'board@0', 'board@x', 'board@1.5']) {
    const issues = invalidIssues(JSON.stringify({ format, items: [] }));
    assert.equal(issues[0].path, 'format', format);
  }
});

test('a higher board version is reported as newer, with its version, and is not read', () => {
  assert.deepEqual(board.parseBoard(JSON.stringify({ format: 'board@2', items: [{ id: 'x', surprise: true }] })), { kind: 'newer', format: 'board@2', version: 2 });
  assert.deepEqual(board.parseBoard(JSON.stringify({ format: 'board@12', items: 'nope' })), { kind: 'newer', format: 'board@12', version: 12 });
});

test('bad JSON and non-object files are invalid with a clear reason', () => {
  assert.equal(invalidIssues('{ "format": ')[0].message, 'is not valid JSON');
  assert.equal(invalidIssues('[]')[0].message, 'must be a JSON object');
});

test('strict fields: a typo or an unknown field is an issue, not a silent drop', () => {
  const issues = invalidIssues(withItems([{ id: 'booking', maquete: 'booking.maquette.json' }]));
  assert.ok(issues.some(issue => issue.path === 'items[0]' && /needs exactly one/.test(issue.message)), JSON.stringify(issues));
  const extra = invalidIssues(JSON.stringify({ format: 'board@1', items: [], colour: 'red' }));
  assert.deepEqual(extra.map(issue => issue.path), ['colour']);
});

test('paths stay inside the board folder and end in the right suffix', () => {
  for (const path of ['../secret.maquette.json', '/abs.maquette.json', 'https://x.invalid/a.maquette.json', 'a/../../b.maquette.json', 'booking.json']) {
    const issues = invalidIssues(withItems([{ id: 'booking', maquette: path }]));
    assert.equal(issues[0].path, 'items[0].maquette', path);
  }
  assert.equal(invalidIssues(withItems([{ id: 'page', html: 'page.html' }]))[0].path, 'items[0].html');
  assert.equal(invalidIssues(withItems([{ id: 'page', html: 'page.mockup.html', device: 'tablet' }]))[0].path, 'items[0].device');
});

test('ids are checked, unique, and the item count is bounded', () => {
  assert.equal(invalidIssues(withItems([{ id: 'has space', note: 'hi' }]))[0].path, 'items[0].id');
  const duplicate = invalidIssues(withItems([{ id: 'n', note: 'a' }, { id: 'n', note: 'b' }]));
  assert.equal(duplicate[0].path, 'items[1].id');
  const many = Array.from({ length: 41 }, (_, index) => ({ id: `n${index}`, note: 'x' }));
  assert.equal(invalidIssues(withItems(many))[0].path, 'items');
});

test('the planner lays maquette screens and HTML frames out left to right, with goto arrows', () => {
  const plan = board.planBoard(parsedBoard(), files);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.frames.map(frame => frame.id), ['booking/sessions', 'booking/details', 'booking/confirmed', 'confirm-html']);
  const sessions = plan.frames[0];
  assert.deepEqual([sessions.x, sessions.y], [0, 267], 'a layout entry keeps its position');
  for (let index = 2; index < plan.frames.length; index++) assert.ok(plan.frames[index].x > plan.frames[index - 1].x, 'frames go left to right');
  const arrows = plan.arrows.map(arrow => `${arrow.from}->${arrow.to}`).sort();
  assert.deepEqual(arrows, [
    'booking/confirmed->booking/sessions',
    'booking/confirmed->confirm-html',
    'booking/details->booking/confirmed',
    'booking/details->booking/sessions',
    'booking/sessions->booking/details',
  ]);
  assert.equal(plan.arrows.find(arrow => arrow.to === 'confirm-html').label, 'richer version');
  const note = plan.notes.find(item => item.id === 'note-1');
  assert.equal(note.text, 'Is the reminder opt-in or opt-out?');
  assert.ok(note.y < 0, 'a note sits above the frame it is near');
});

test('missing files and dangling links are reported as problems, and the rest is still drawn', () => {
  const plan = board.planBoard(parsedBoard(), new Map([['confirm.mockup.html', files.get('confirm.mockup.html')]]));
  assert.deepEqual(plan.problems.map(problem => problem.path), ['items.booking', 'links.booking/confirmed->confirm-html']);
  assert.equal(plan.problems[0].message, 'booking.maquette.json is missing');
  assert.deepEqual(plan.frames.map(frame => frame.id), ['confirm-html']);
  const dangling = board.parseBoard(JSON.stringify({ format: 'board@1', items: [{ id: 'confirm-html', html: 'confirm.mockup.html' }], links: [{ from: 'confirm-html', to: 'nowhere/screen' }] }));
  const problems = board.planBoard(dangling.board, files).problems;
  assert.deepEqual(problems, [{ path: 'links.confirm-html->nowhere/screen', message: 'nowhere/screen is not a frame on this board' }]);
});

test('an edit round-trip writes frame moves and notes back into board@1 and nothing else', () => {
  const before = parsedBoard();
  const plan = board.planBoard(before, files);
  const positions = Object.fromEntries(plan.frames.map(frame => [frame.id, { x: frame.x + 40.4, y: frame.y - 12 }]));
  const edited = board.applyCanvasEdits(before, {
    positions,
    notes: [{ id: 'note-1', text: 'Opt-in or opt-out? Ask the PM.' }, { id: 'note-2', text: 'Check the price with finance.' }],
  });
  assert.equal(edited.kind, 'ok', JSON.stringify(edited));
  const next = edited.board;
  assert.deepEqual(next.items.filter(item => !('note' in item)), before.items.filter(item => !('note' in item)), 'maquette and HTML items are unchanged');
  assert.deepEqual(next.links, before.links);
  assert.equal(next.items.find(item => item.id === 'note-1').near, 'confirm-html', 'a kept note keeps its frame');
  assert.equal(next.items.find(item => item.id === 'note-2').near, undefined);
  assert.deepEqual(next.layout['booking/sessions'], { x: 40, y: 255 });
  const text = board.serializeBoard(next);
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text.includes('"format": "board@1"'), true);
  const reread = board.parseBoard(text);
  assert.equal(reread.kind, 'ok', JSON.stringify(reread));
  assert.deepEqual(reread.board, next, 'the written file reads back to the same board');
});

test('a deleted note leaves the file, and invalid canvas edits are refused with reasons', () => {
  const before = parsedBoard();
  const removed = board.applyCanvasEdits(before, { positions: {}, notes: [] });
  assert.equal(removed.kind, 'ok');
  assert.equal(removed.board.items.some(item => 'note' in item), false);
  const bad = board.applyCanvasEdits(before, {
    positions: { 'booking/sessions': { x: Number.NaN, y: 0 }, 'bad id!': { x: 0, y: 0 } },
    notes: [{ id: 'confirm-html', text: 'clashes with a frame id' }, { id: 'n2', text: '   ' }],
  });
  assert.equal(bad.kind, 'invalid');
  assert.deepEqual(bad.issues.map(issue => issue.path), ['notes[0].id', 'notes[1].text', 'positions.booking/sessions', 'positions.bad id!']);
});

test('the planner and the edits never change their input', () => {
  const before = parsedBoard();
  const snapshot = JSON.stringify(before);
  board.planBoard(before, files);
  board.applyCanvasEdits(before, { positions: { 'booking/sessions': { x: 5, y: 5 } }, notes: [] });
  assert.equal(JSON.stringify(before), snapshot);
});
