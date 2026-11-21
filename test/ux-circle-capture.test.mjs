// A scenario state that starts with the composer folded to a circle (`circle=1`) must be capturable: the page is "ready" when the circle is there, not only when the bar's field is.
// Drives the runner's own path (capture -> runStates -> open) in fast mode over the real layout:bar-reserve and layout:update-notice fixtures.
// Before the fix layout:bar-reserve waited for composer-input, which a circle never shows, and open() threw after 15 s (the showcase workflow failed on release).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { capture } from '../ux/runner/capture.mjs';
import { loadAll } from '../ux/runner/scenario.mjs';

const skip = !process.env.CHROMIUM && !process.env.CI;

for (const target of ['layout:bar-reserve', 'layout:update-notice']) {
  test(`${target}: every state with a folded circle opens (the ready selector accepts the circle)`, { skip, timeout: 240000 }, async () => {
    assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
    const s = loadAll().find(x => x.target === target);
    const folded = s.states.filter(st => /(^|&)circle=1(&|$)/.test(st.query ?? ''));
    assert.ok(folded.length >= 2, 'the scenario has circle states');
    const { result } = await capture(s, mkdtempSync(join(tmpdir(), 'ux-circle-')), { fast: true, onlyStates: true, onlyViewport: s.viewports[0].name });
    assert.deepEqual(result.stateFailures, []);
    for (const st of folded) assert.ok(result.states.some(r => r.id === st.id), `state ${st.id} ${st.name} was reached`);
  });
}
