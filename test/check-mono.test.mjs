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

test('the important modifier is still font-mono', () => {
  assert.deepEqual(lines('const a = <span className="font-mono! text-xs" />;'), [1]);
  assert.deepEqual(lines('const a = <span className="!font-mono" />;'), [1]);
  assert.deepEqual(lines('const a = <span className="md:hover:!font-mono" />;'), [1]);
});

test('a descendant target that reaches only code is allowed; any other target is refused', () => {
  for (const tag of ['code', 'pre', 'kbd', 'samp']) assert.deepEqual(lines(`const a = <div className="[&_${tag}]:font-mono [&>${tag}]:font-mono!" />;`), []);
  assert.deepEqual(lines('const a = <div className="[&_span]:font-mono" />;'), [1]);
  assert.deepEqual(lines('const a = <div className="[&_code]:font-mono *:font-mono" />;'), [1]);
  assert.deepEqual(lines('const a = <div className="[&_code_span]:font-mono" />;'), [1]);
});

test('D-1782: the kit Textarea may carry font-mono for variant="code"; no other file or element may', () => {
  const field = 'const a = <textarea className={cn(variant === "code" && "font-mono")} />;';
  assert.deepEqual(monoViolations(field, 'shadcn/ui/textarea.tsx'), []);
  assert.equal(monoViolations(field, 'registry/x/y.tsx').length, 1);
  assert.equal(monoViolations('const a = <div className="font-mono" />;', 'shadcn/ui/textarea.tsx').length, 1);
});

test('the kit passes', () => {
  assert.deepEqual(checkMono(), []);
});
