import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

test('shared demo CSS includes Trace status, disclosure and transition utilities without extra sources', async () => {
  const css = await buildTailwind();
  assert.ok(css.includes('group-aria-expanded\\/trace-collapsible-trigger'), 'the shared CSS must rotate the expanded Trace chevron');
  assert.ok(css.includes('data-\\[status\\=error\\]\\:text-destructive'), 'Trace failures use the destructive role');
  assert.ok(css.includes('data-\\[status\\=pending\\]\\:opacity-60'), 'pending Trace lines use the upstream opacity');
  assert.ok(css.includes('transition-\\[height\\]'), 'Trace disclosure content gets its height transition');
});
