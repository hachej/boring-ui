// The accounts-payable backend: one invoice record per file in a workspace provider (examples/shared/sqlite-workspaces.mjs; re-point
// after the examples restructure). A decision is a conditional write: it names the revision the person saw, a stale revision is refused,
// and the committed write returns a receipt. The page's buttons and the agent's `decide_invoice` tool (behind the approval card) call
// the same `decide`, so there is one way to change an invoice. Fictional data only.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { ACCOUNTS, INVOICES, SUPPLIERS } from './data.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const locate = id => ({ resource: { providerId: 'ap-invoices', path: `invoices/${id}.json` }, view: { kind: 'published' } });

export const decisionSchema = z.strictObject({
  invoice: z.string().regex(/^INV-\d{4}$/),
  action: z.enum(['approve', 'recode', 'hold']),
  /** The account for `recode`. */
  account: z.enum(ACCOUNTS).optional(),
  note: z.string().max(200).optional(),
  /** The revision of the record the person saw. */
  expected: z.string().optional(),
});

export async function openAccountsPayable({ filename, person }) {
  const store = openSqliteWorkspaces({ filename, providerId: 'ap-invoices' });
  const files = store.workspace(person.scopeId);
  for (const invoice of INVOICES) {
    const result = await files.publication.publish({ operationId: `seed-${invoice.id}`, atomicity: 'all-or-nothing',
      changes: [{ kind: 'create', target: locate(invoice.id), expected: { kind: 'absent' }, bytes: encoder.encode(JSON.stringify(invoice)), mediaType: 'application/json' }] }, person);
    if (result.kind !== 'committed' && result.kind !== 'conflict') throw new Error(`Seeding ${invoice.id}: ${result.kind}`);
  }
  const read = async id => {
    const found = await files.read({ target: locate(id), revision: { kind: 'latest' } }, person);
    return found.kind === 'available' ? { ...JSON.parse(decoder.decode(found.snapshot.bytes)), revision: found.snapshot.ref.revision } : undefined;
  };
  const list = async () => (await Promise.all(INVOICES.map(invoice => read(invoice.id)))).filter(Boolean);
  /** Open invoices from the same supplier with the same PO and amount: the metadata behind the duplicate alert. */
  const duplicatesOf = (invoice, all) => all.filter(other => other.id !== invoice.id && other.supplier === invoice.supplier && other.po === invoice.po && other.amount === invoice.amount && other.status !== 'rejected');

  async function decide(input) {
    const decision = decisionSchema.parse(input);
    if (decision.action === 'recode' && !decision.account) return { kind: 'denied', reason: 'A re-code names the account' };
    const current = await read(decision.invoice);
    if (!current) return { kind: 'denied', reason: 'Unknown invoice' };
    if (decision.expected && decision.expected !== current.revision) return { kind: 'conflict', reason: 'The invoice changed since you opened it', current: current.revision };
    if (current.status !== 'pending') return { kind: 'conflict', reason: `The invoice is already ${current.status}`, current: current.revision };
    const { revision, ...record } = current;
    const next = { ...record, status: decision.action === 'hold' ? 'on-hold' : 'approved', ...(decision.action === 'recode' ? { account: decision.account, recodedFrom: record.account } : {}), ...(decision.note ? { note: decision.note } : {}) };
    // One operation per (invoice, revision, decision): repeating the same call returns the same receipt instead of writing twice.
    const operationId = `decide-${createHash('sha256').update(`${decision.invoice}:${revision}:${decision.action}:${decision.account ?? ''}`).digest('hex').slice(0, 24)}`;
    const result = await files.publication.publish({ operationId, atomicity: 'all-or-nothing',
      changes: [{ kind: 'replace', target: { ...locate(decision.invoice), revision }, bytes: encoder.encode(JSON.stringify(next)), mediaType: 'application/json' }] }, person);
    if (result.kind !== 'committed') return result;
    const [change] = result.receipt.changes;
    return { kind: 'committed', receipt: { operationId: result.receipt.operationId, invoice: decision.invoice, action: decision.action, revision: change.after.revision } };
  }

  return { list, read, decide, duplicatesOf, supplier: id => SUPPLIERS[id], close: () => store.close() };
}
