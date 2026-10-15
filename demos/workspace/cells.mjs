// The app's cells and screens, as docs/architecture/EXPERIENCE.md describes them (the shape examples/morning uses).
// A cell is a registered kind at a version with a props schema, `$state` bindings (paths into the app's state, never values), named actions
// and composition metadata (description and flags: no record content). Each screen is a FIXED experience descriptor over cell references,
// checked by the same validator the other examples use. The renderers are in ./page.tsx. A generated region would be offered these same
// cells by metadata alone (see the README roadmap); none is built here.
import { validateExperience } from '@hachej/boring-ui-kit/experience/compose';
import { z } from 'zod';

const none = z.strictObject({});
/** The kinds. `flags` are the enumerated metadata a composer may see; `actions` the named actions a cell of the kind may use. */
export const KINDS = {
  'ap/approval-queue': { version: 1, description: 'Invoices waiting for a decision', props: none, actions: ['open_invoice'], flags: ['needs-decision'] },
  'ap/cash-due': { version: 1, description: 'What falls due and when', props: z.strictObject({ scope: z.enum(['all', 'supplier']) }), actions: [], flags: ['time-bound'] },
  'ap/invoice-summary': { version: 1, description: 'The extracted fields of one invoice, with its decision buttons', props: none, actions: ['approve', 'recode', 'hold', 'open_supplier'], flags: ['needs-decision', 'amount-bucket'] },
  'ap/invoice-pdf': { version: 1, description: 'The invoice document as received', props: none, actions: [], flags: [] },
  'ap/duplicate-alert': { version: 1, description: 'Invoices that look like the same bill twice', props: z.strictObject({ scope: z.enum(['invoice', 'supplier']) }), actions: ['open_invoice'], flags: ['needs-decision'] },
  'ap/supplier-card': { version: 1, description: 'The supplier, its terms and why it is flagged', props: none, actions: ['open_invoice'], flags: [] },
  'ap/policy-excerpt': { version: 1, description: 'The part of the AP policy that applies to the open invoice', props: none, actions: [], flags: [] },
};

/** Named actions. `durable` ones are the backend's (a conditional write with a receipt, `POST /api/actions/<name>`); the rest only move the page. */
export const ACTIONS = { open_invoice: { durable: false }, open_supplier: { durable: false }, approve: { durable: true }, recode: { durable: true }, hold: { durable: true } };

/** Cell instances: `state` maps a binding name to a path of the app's state (resolved per viewer by the page). */
export const CELLS = [
  { ref: 'approvals/queue', kind: 'ap/approval-queue', props: {}, state: { rows: '/ap/approvals' } },
  { ref: 'approvals/cash-due', kind: 'ap/cash-due', props: { scope: 'all' }, state: { rows: '/ap/approvals' } },
  { ref: 'invoice/summary', kind: 'ap/invoice-summary', props: {}, state: { invoice: '/ap/invoice' } },
  { ref: 'invoice/duplicates', kind: 'ap/duplicate-alert', props: { scope: 'invoice' }, state: { matches: '/ap/invoice/duplicates' } },
  { ref: 'invoice/pdf', kind: 'ap/invoice-pdf', props: {}, state: { invoice: '/ap/invoice' } },
  { ref: 'invoice/policy', kind: 'ap/policy-excerpt', props: {}, state: { invoice: '/ap/invoice' } },
  { ref: 'supplier/card', kind: 'ap/supplier-card', props: {}, state: { supplier: '/ap/supplier', invoices: '/ap/supplier/invoices' } },
  { ref: 'supplier/duplicates', kind: 'ap/duplicate-alert', props: { scope: 'supplier' }, state: { matches: '/ap/supplier/duplicates' } },
  { ref: 'supplier/cash-due', kind: 'ap/cash-due', props: { scope: 'supplier' }, state: { rows: '/ap/supplier/invoices' } },
];

// Installed-ness is checked once, here: every instance names an installed kind, parses its props and uses only actions its kind allows.
for (const cell of CELLS) {
  const kind = KINDS[cell.kind];
  if (!kind) throw new TypeError(`${cell.ref}: unknown kind ${cell.kind}`);
  kind.props.parse(cell.props);
  for (const name of cell.actions ?? kind.actions) if (!kind.actions.includes(name) || !(name in ACTIONS)) throw new TypeError(`${cell.ref}: action ${name} is not installed for ${cell.kind}`);
}

/** What validateExperience (and the renderer) know of a cell. */
export const experienceCells = CELLS.map(({ ref, kind }) => Object.freeze({ ref, kind, version: KINDS[kind].version }));
const kinds = { 'boring/stack': 1, 'boring/row': 1, 'boring/cell': 1, ...Object.fromEntries(Object.entries(KINDS).map(([name, kind]) => [name, kind.version])) };
const stack = (children, gap = 'medium') => ({ type: 'boring/stack', props: { gap }, children });
const row = children => ({ type: 'boring/row', props: { gap: 'medium' }, children });
const cell = ref => ({ type: 'boring/cell', props: { ref }, children: [] });
const screen = (name, title, elements) => validateExperience({ format: 'boring.experience', version: 1, name, title, source: 'fixed', kinds, root: 'page', elements }, { cells: experienceCells, canView: () => true });

export const SCREENS = {
  approvals: screen('approvals', 'Approvals', { page: stack(['queue', 'due']), queue: cell('approvals/queue'), due: cell('approvals/cash-due') }),
  invoice: screen('invoice', 'Invoice', { page: stack(['summary', 'duplicates', 'documents']), summary: cell('invoice/summary'), duplicates: cell('invoice/duplicates'),
    documents: row(['pdf', 'policy']), pdf: cell('invoice/pdf'), policy: cell('invoice/policy') }),
  supplier: screen('supplier', 'Supplier', { page: stack(['card', 'duplicates', 'due']), card: cell('supplier/card'), duplicates: cell('supplier/duplicates'), due: cell('supplier/cash-due') }),
};

/** The candidate list a composer would be given: ids, descriptions, kinds and flags only. */
export const candidates = () => CELLS.map(({ ref, kind }) => ({ id: ref, kind, description: KINDS[kind].description, flags: KINDS[kind].flags }));
