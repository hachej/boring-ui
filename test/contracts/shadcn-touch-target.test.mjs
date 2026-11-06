import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// D-1727. On a phone (below md) every shadcn form control reaches a 44px target. Source-matching test: it reads the class strings of
// shadcn/ui/*.tsx and does not render. The rendered 390px check for button, input and select is test/contracts/compact-primitives.test.mjs;
// the PR carries a browser measurement for the rest. The Tailwind spacing unit is 4px.
const source = name => readFileSync(new URL(`../../shadcn/ui/${name}.tsx`, import.meta.url), 'utf8');
const tokens = text => text.split(/\s+/);
const classesAt = (name, anchor) => new RegExp(`"(${anchor}[^"]*)"`).exec(source(name))[1];

test('Input, Button and the Select trigger already carry the 44px phone rule', () => {
  assert.ok(tokens(source('input')).includes('max-md:h-11'));
  assert.ok(tokens(source('button')).includes('max-md:min-h-11'));
  assert.ok(tokens(source('select')).includes('max-md:min-h-11'));
});

test('NativeSelect puts the 44px phone target on the <select> element itself, for both sizes', () => {
  const text = source('native-select');
  const select = /<select\b[\s\S]*?className="([^"]*)"/.exec(text)?.[1];
  assert.ok(select, 'no <select className>');
  // min-h, not h: the data-[size=sm]:h-8 variant out-ranks a plain max-md:h-11 on specificity; min-height wins over any height.
  assert.ok(tokens(select).includes('max-md:min-h-11'), 'the select element has max-md:min-h-11');
  const wrapper = /"(group\/native-select[^"]*)"/.exec(text)?.[1] ?? '';
  assert.doesNotMatch(wrapper, /min-h|\bh-\d/, 'the wrapper does not carry the height');
});

test('Checkbox and Radio hit areas (the pseudo-element is inset from the padding box of the 16px box) reach 44px on a phone', () => {
  for (const [name, anchor] of [['checkbox', 'peer relative flex size-4'], ['radio-group', 'group/radio-group-item peer relative']]) {
    const classes = tokens(classesAt(name, anchor));
    assert.ok(classes.includes('max-md:after:-inset-x-4'), `${name}: wider hit area on a phone`);
    assert.ok(classes.includes('max-md:after:-inset-y-4'), `${name}: taller hit area on a phone`);
    assert.ok(14 + 2 * 4 * 4 >= 44, 'inset is from the padding box: 14px inside the 1px border + 2 x 16px = 46px');
  }
});

test('Switch hit area reaches 44px on a phone for both sizes (18.4px and 14px tracks)', () => {
  const classes = tokens(classesAt('switch', 'peer group/switch'));
  assert.ok(classes.includes('max-md:data-[size=default]:after:-inset-y-3.5'));
  assert.ok(classes.includes('max-md:data-[size=sm]:after:-inset-y-4'));
  assert.ok(18.4 + 2 * 3.5 * 4 >= 44 && 14 + 2 * 4 * 4 >= 44);
  assert.ok(classes.includes('after:-inset-x-3') && 24 + 2 * 3 * 4 >= 44, 'the narrowest switch is 48px wide');
});

test('Textarea is multi-line: its 64px minimum already exceeds 44px', () => {
  assert.ok(tokens(source('textarea')).includes('min-h-16'));
});

test('Combobox, DatePicker, a 44px checkbox/radio/switch row', { skip: 'none exists in shadcn/ui or registry/; a row component is a design decision (D-1727)' }, () => {});
