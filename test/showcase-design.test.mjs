import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { showcaseFindings } from '../scripts/check-showcase-design.mjs';

// The showcase demos the kit, so its fixtures use kit parts: a raw control or a hand-written size in one fails the check.
const scan = source => { const dir = mkdtempSync(join(tmpdir(), 'showcase-design-')); writeFileSync(join(dir, 'page.jsx'), source); return showcaseFindings(dir, ['page.jsx']); };

test('a raw button, checkbox or table in a showcase fixture is a finding; the kit parts are not', () => {
  const raw = scan('export const A = () => <div><button type="button" className="border">Go</button><input type="checkbox" /><table><tbody /></table></div>;\n');
  assert.deepEqual([...new Set(raw.map(finding => finding.rule))], ['raw-element']);
  assert.equal(raw.length, 3);
  assert.deepEqual(scan("import { Button } from '@/components/ui/button';\nexport const A = () => <Button variant=\"outline\">Go</Button>;\n"), []);
});

test('the showcase fixtures and demo pages pass', () => {
  assert.deepEqual(showcaseFindings().map(finding => `${finding.file}:${finding.line} ${finding.rule}`), []);
});
