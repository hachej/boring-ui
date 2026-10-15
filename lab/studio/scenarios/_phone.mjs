// Helpers for the phone and tablet scenarios (not a scenario: files starting with `_` are skipped by the loader).
import assert from 'node:assert/strict';

export function phoneKit(t) {
  const { browser, q } = t;
  const noOverflow = async label => {
    const sizes = await browser.evaluate(`({ scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: window.innerWidth })`);
    assert.ok(sizes.scroll <= sizes.inner && sizes.body <= sizes.inner, `${label}: horizontal overflow ${JSON.stringify(sizes)}`);
  };
  // Every visible interactive control inside `scope` smaller than 40x40 CSS px.
  const audit = scope => browser.evaluate(`(() => {
    const root = ${scope};
    const controls = [...root.querySelectorAll('button, a[href], select, input:not([type=hidden]), textarea, [role=option], [role=radio], [role=tab], summary')];
    return controls.filter(e => !e.classList.contains('sr-only') && e.checkVisibility?.({ visibilityProperty: true })).flatMap(e => {
      // A checkbox is operated through its label.
      const r = (e.closest('label') ?? e).getBoundingClientRect();
      if (!r.width || !r.height || r.right < 0 || r.left > innerWidth) return [];
      return r.width < 40 || r.height < 40 ? [{ control: (e.dataset.testid || e.getAttribute('aria-label') || e.textContent.trim() || e.tagName).slice(0, 40), width: Math.round(r.width), height: Math.round(r.height) }] : [];
    });
  })()`);
  const small = [];
  const check = async (label, scope) => { for (const item of await audit(scope)) small.push({ state: label, ...item }); };
  const inViewport = selector => browser.evaluate(`(() => { const r = ${q(selector)}?.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`);
  /** Fails when a checked control was smaller than 40x40 CSS px; the list is also an evidence file. */
  const reportSmall = async name => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const directory = process.env.STUDIO_EVIDENCE ?? '.cache/evidence/studio';
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${name}-small-targets.json`), JSON.stringify(small, null, 2));
    console.log(`controls under 40x40 CSS px (${name}): ${small.length}${small.length ? `\n${small.map(item => `  [${item.state}] ${item.control} ${item.width}x${item.height}`).join('\n')}` : ''}`);
    assert.deepEqual(small, [], 'every checked control is at least 40x40 CSS px');
  };
  return { noOverflow, audit, check, inViewport, small, reportSmall };
}
