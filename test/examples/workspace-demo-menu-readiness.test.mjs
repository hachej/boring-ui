import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { Window } from 'happy-dom';
import { q } from '@hachej/boring-testing/browser';

for (const mode of ['source', 'rich']) for (const expanded of [false, true]) test(`workspace demo's actual ${mode} mode action handles an ${expanded ? 'open' : 'exiting'} menu`, async t => {
  const source = readFileSync(new URL('../../demos/workspace/journey.mjs', import.meta.url), 'utf8');
  const marker = "await browser.screenshot('4-policy.png');";
  const start = source.indexOf(marker);
  const end = source.indexOf('await browser.type(', start);
  assert.ok(start !== -1 && end > start, 'exercise the actual first policy mode switch');
  const action = mode === 'source' ? source.slice(start + marker.length, end) : source.split('\n').find(line => /await (?:browser\.click|viewAction).*mode-rich/.test(line));
  assert.ok(action, 'the actual mode switch exists');
  const helperStart = source.indexOf('const viewAction = async (prefix, id) => {');
  const helperEnd = source.indexOf('\n  };', helperStart);
  const helper = helperStart === -1 ? '' : source.slice(helperStart, helperEnd + 5);
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const menu = `<div data-testid="viewer-more-list" ${expanded ? '' : 'data-ending-style'}><div data-testid="viewer-mode-${mode}" role="menuitemradio">${mode}</div></div>`;
  window.document.body.innerHTML = `<div data-testid="library-document"><button data-testid="viewer-more" aria-expanded="${expanded}">More</button>${expanded ? '' : menu}</div>${expanded ? menu : ''}`;
  const trigger = window.document.querySelector('button');
  const popup = window.document.querySelector('[data-testid=viewer-more-list]');
  const presses = [], waits = [];
  const browser = {
    evaluate: async expression => window.eval(expression),
    click: async expression => {
      const target = window.eval(expression);
      assert.ok(target, 'the actual journey must open the menu before looking for its portaled item');
      if (target === trigger) {
        assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'do not toggle an already-open menu closed');
        presses.push('open');
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        assert.equal(target, popup.firstElementChild);
        assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'never click an exiting menu');
        assert.equal(popup.hasAttribute('data-ending-style'), false);
        presses.push(mode);
        trigger.setAttribute('aria-expanded', 'false');
        popup.remove();
      }
    },
    until: async (label, expression, timeout) => {
      waits.push(timeout);
      if (popup.hasAttribute('data-ending-style')) {
        assert.equal(window.eval(expression), false, 'an expanded trigger alone does not make the exiting popup ready');
        popup.removeAttribute('data-ending-style');
      }
      assert.ok(window.eval(expression), label);
    },
  };
  await runInNewContext(`(async () => { ${helper}\n${action} })()`, { browser, q });
  assert.deepEqual(presses, expanded ? [mode] : ['open', mode]);
  assert.deepEqual(waits, [5000, 5000]);
});
