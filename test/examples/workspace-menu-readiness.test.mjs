import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { Window } from 'happy-dom';
import { q } from '@hachej/boring-testing/browser';

test('the actual workspace journey helper reopens a closed trigger instead of clicking an exiting popup', async t => {
  const source = readFileSync(new URL('../../examples/workspace-app/journey.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const viewAction = async (prefix, id) => {');
  assert.notEqual(start, -1);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1);
  const window = new Window();
  t.after(() => window.happyDOM.close());
  window.document.body.innerHTML = '<button data-testid="artifact-more" aria-expanded="false">More</button><div data-testid="artifact-more-list" data-ending-style><div data-testid="artifact-mode-source" role="menuitemradio">Markdown</div></div>';
  const trigger = window.document.querySelector('button');
  const popup = window.document.querySelector('[data-testid=artifact-more-list]');
  const presses = [];
  const waits = [];
  const browser = {
    evaluate: async expression => window.eval(expression),
    click: async expression => {
      const target = window.eval(expression);
      assert.ok(target);
      if (target === trigger) {
        presses.push('open');
        trigger.setAttribute('aria-expanded', 'true');
        popup.removeAttribute('data-ending-style');
      } else {
        assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'old helper clicked into a closing popup');
        assert.equal(popup.hasAttribute('data-ending-style'), false);
        presses.push('source');
        trigger.setAttribute('aria-expanded', 'false');
        popup.remove();
      }
    },
    until: async (label, expression, timeout) => {
      waits.push(timeout);
      assert.ok(window.eval(expression), label);
    },
  };
  const viewAction = runInNewContext(`(${source.slice(start + 'const viewAction = '.length, end + 4)})`, { browser, q });
  await viewAction('artifact', 'mode-source');
  assert.deepEqual(presses, ['open', 'source']);
  assert.deepEqual(waits, [5000, 5000]);
});
