import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccountsPayable } from '../../demos/workspace/ap.mjs';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

// The workspace demo's backend: a decision is a conditional write on the reviewed revision, and repeating it returns its receipt.
const person = { scopeId: 'fictional-ap-team', principalId: 'fictional-approver', initiatorId: 'fictional-approver' };

test('a decision needs the reviewed revision, refuses a stale one, and a retry returns the same receipt', async t => {
  const store = openSqliteWorkspaces({ filename: join(mkdtempSync(join(tmpdir(), 'boring-ap-')), 'ap.sqlite'), providerId: 'ap-invoices' });
  t.after(() => store.close());
  const ap = await openAccountsPayable({ files: store.workspace(person.scopeId), person });
  const reviewed = (await ap.read('INV-2041')).revision;

  assert.equal((await ap.decide({ invoice: 'INV-2041', action: 'approve' })).kind, 'denied', 'no revision, no decision');
  const stale = await ap.decide({ invoice: 'INV-2041', action: 'approve', expected: 'not-the-revision' });
  assert.equal(stale.kind, 'conflict');
  assert.equal((await ap.read('INV-2041')).status, 'pending', 'a stale decision writes nothing');

  const first = await ap.decide({ invoice: 'INV-2041', action: 'recode', account: '6300 Marketing', expected: reviewed });
  assert.equal(first.kind, 'committed');
  const retry = await ap.decide({ invoice: 'INV-2041', action: 'recode', account: '6300 Marketing', expected: reviewed });
  assert.deepEqual(retry, first, 'the same decision on the same revision returns the same receipt');
  assert.equal((await ap.decide({ invoice: 'INV-2041', action: 'hold', expected: reviewed })).kind, 'conflict', 'another decision on the old revision is refused');
  const saved = await ap.read('INV-2041');
  assert.deepEqual([saved.status, saved.account], ['approved', '6300 Marketing']);
});
