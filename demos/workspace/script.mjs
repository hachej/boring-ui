// The scripted model's side of the journey (format: lab/studio/scripted-model.mjs): what the "model" answers to each
// prompt, so the journey runs the same way every time without a key. Used with STUDIO_MODEL=scripted. Fictional content only.
// The turns that matter read the request they answer: they check the request-context block the host rendered (placement and screen), so a
// regression in what travels with the request shows up as a different answer.
const call = (name, args) => ({ tools: [{ name, args }] });
const seen = ctx => JSON.stringify(ctx.messages);

export const SOURCES = [{ name: 'workspace-demo', entries: Object.entries({
  // Earlier conversations (seeded by the server).
  'month-end close': ['Left in the close: accruals for March, the bank reconciliation and the supplier statement check.'],
  'payment terms for Fernhill': ['Fernhill Labels is on net 30 from the invoice date.'],
  // 1. Docked: the agent leads and opens the queue in the viewer.
  'what needs my approval this week': [
    ctx => seen(ctx).includes('Placement: docked') ? call('pending_approvals', {}) : 'Three invoices are waiting; ask me to open the queue.',
    call('show', { screen: 'approvals' }),
    'Three invoices are waiting for you this week: INV-2041 and INV-2043 from Linden Print Co, and INV-2044 from North Quay Logistics. I opened the queue in the viewer.'],
  // 3. The person opened another invoice; the agent sees it in the screen context.
  'Anything odd about this one': [
    ctx => seen(ctx).includes('looking at: Invoice {\\"id\\":\\"INV-2043\\"}') ? call('get_invoice', { id: 'INV-2043' }) : 'Tell me which invoice you mean.',
    'INV-2043 looks like a duplicate of INV-2041: same supplier, same PO-771 and the same 1,284.00 EUR, two days apart.'],
  // (b) The AP policy is open in the library column; the agent reads it and the invoice.
  'Does this invoice respect the policy': [
    ctx => seen(ctx).includes('looking at: Library document {\\"path\\":\\"Policies/AP policy.md\\"}') ? call('read', { path: 'Policies/AP policy.md' }) : 'Open the policy and ask again.',
    call('get_invoice', { id: 'INV-2043' }),
    'No. Section 2 of the policy holds an invoice with the same supplier, PO and amount as an open one, and INV-2043 matches INV-2041. INV-2041 itself is fine: above 1,000 EUR it needs one approver.'],
  // The person attaches a note (uploaded into the workspace, carried as an @path): the agent can read it.
  'Please look at the attached note': [
    ctx => /@uploads\/[^\s]*vendor-note/.test(seen(ctx)) ? call('read', { path: seen(ctx).match(/uploads\/[^\s"\\]*vendor-note[^\s"\\]*/)[0] }) : 'I do not see an attachment.',
    'Read it: Linden Print asks for payment by the 3rd. I will keep that in mind for INV-2041.'],
  // The agent writes a file in the workspace (observed, no receipt) and opens it in the viewer.
  'create a new file tt.md': [
    call('write', { path: 'tt.md', content: '# Notes\n\nINV-2043 duplicates INV-2041: hold it until Linden Print confirms.\n' }),
    call('show', { screen: 'file', path: 'tt.md' }),
    'I created tt.md in the workspace and opened it in the viewer.'],
  // 4. The agent reads the invoice, proposes, and the approval card is the person's confirmation; the backend returns a receipt.
  'What would you do with them': [
    call('get_invoice', { id: 'INV-2041' }),
    ctx => ({ text: 'I would approve INV-2041 but code it to 6300 Marketing, since it is the catalogue, and keep INV-2043 on hold. Approve below to save it.',
      tools: [{ name: 'decide_invoice', args: { invoice: 'INV-2041', action: 'recode', account: '6300 Marketing', note: 'Catalogue is a marketing cost', expected: ctx.last.json.revision } }] }),
    call('show', { screen: 'invoice', id: 'INV-2041' }),
    ctx => `Done: INV-2041 is approved and coded to 6300 Marketing. Receipt ${ctx.results.find(result => result.name === 'decide_invoice')?.json?.receipt?.operationId ?? 'missing'}.`],
  // 4b. A decision on a revision nobody reviewed is refused by the same backend, through the same tool and card.
  'Now hold INV-2043': [
    call('decide_invoice', { invoice: 'INV-2043', action: 'hold', expected: 'stale-revision' }),
    ctx => ctx.last.isError ? `Not saved: ${ctx.last.json.reason}.` : 'Saved.'],
  // 6. Floating: the person leads, so a short answer and no navigation.
  'Why is this flagged': [
    ctx => seen(ctx).includes('Placement: floating') ? 'Linden Print Co sent two invoices, INV-2041 and INV-2043, for the same PO and amount.' : call('show', { screen: 'supplier', id: 'linden-print' })],
  // 7. Back in the dock: the same conversation goes on.
  'that is all for today': ['Good. INV-2044 from North Quay is the one left in the queue.'],
}).map(([match, turns]) => ({ match, turns })) }];
