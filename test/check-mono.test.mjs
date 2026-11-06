import assert from 'node:assert/strict';
import test from 'node:test';
import { checkMono, monoViolations } from '../scripts/check-mono.mjs';

const lines = source => monoViolations(source).map(item => item.line);

test('font-mono on a span, a dd or through cn() fails', () => {
  assert.deepEqual(lines('const a = <span className="font-mono text-xs">3 Nov</span>;'), [1]);
  assert.deepEqual(lines('const a = <dd className={cn(\'x\', numeric && \'md:font-mono\')}>1</dd>;'), [1]);
  assert.deepEqual(lines('const a = <b className={`font-mono ${x}`}>1</b>;'), [1]);
});

test('code, kbd, pre, samp and data-mono-id pass', () => {
  for (const tag of ['code', 'kbd', 'pre', 'samp']) assert.deepEqual(lines(`const a = <${tag} className="font-mono">x</${tag}>;`), []);
  assert.deepEqual(lines('const a = <span data-mono-id className="font-mono">a1b2c3</span>;'), []);
});

test('a font-mono string outside JSX fails, so a variable cannot smuggle it in', () => {
  assert.deepEqual(lines("const mono = 'font-mono text-sm';\nconst a = <span className={mono} />;"), [1]);
});

test('other classes are not mistaken for it', () => {
  assert.deepEqual(lines('const a = <span className="font-monospace text-mono --font-mono font-semibold" />;'), []);
});

test('the kit passes', () => {
  assert.deepEqual(checkMono(), []);
});
