// Fictional apps and records. Every name, company and figure here is invented.

export const apps = {
  writing: {
    name: 'Ledger Notes', kind: 'writing',
    manifest: { exposes: ['documents'], accepts: ['insert-text'] },
  },
  crm: {
    name: 'Orbit CRM', kind: 'crm',
    manifest: { exposes: ['contacts', 'deals'], actions: ['log-touch', 'draft-follow-up'] },
    contacts: [
      { id: 'c1', name: 'Mira Kestrel', company: 'Harbor Lights Co.', role: 'Head of Ops', lastTouch: 21, mood: 'warm' },
      { id: 'c2', name: 'Teo Varga', company: 'Northwind Tiles', role: 'CFO', lastTouch: 3, mood: 'cautious' },
      { id: 'c3', name: 'Ana Pell', company: 'Copperleaf Bakery', role: 'Founder', lastTouch: 9, mood: 'excited' },
      { id: 'c4', name: 'Jonas Reed', company: 'Bluefin Logistics', role: 'Procurement', lastTouch: 44, mood: 'silent' },
    ],
    deals: [
      { id: 'd1', title: 'Harbor Lights renewal', company: 'Harbor Lights Co.', value: 18000, stage: 'proposal', risk: 0.4 },
      { id: 'd2', title: 'Northwind pilot', company: 'Northwind Tiles', value: 7200, stage: 'negotiation', risk: 0.2 },
      { id: 'd3', title: 'Copperleaf expansion', company: 'Copperleaf Bakery', value: 12500, stage: 'discovery', risk: 0.1 },
      { id: 'd4', title: 'Bluefin rollout', company: 'Bluefin Logistics', value: 31000, stage: 'stalled', risk: 0.8 },
    ],
  },
  invoices: {
    name: 'Tally Invoices', kind: 'invoices',
    manifest: { exposes: ['invoices'], actions: ['send-reminder'] },
    invoices: [
      { id: 'INV-1041', company: 'Harbor Lights Co.', amount: 4200, due: -12, status: 'overdue' },
      { id: 'INV-1042', company: 'Northwind Tiles', amount: 1800, due: 6, status: 'sent' },
      { id: 'INV-1043', company: 'Copperleaf Bakery', amount: 950, due: -2, status: 'overdue' },
      { id: 'INV-1044', company: 'Bluefin Logistics', amount: 7600, due: -31, status: 'overdue' },
      { id: 'INV-1045', company: 'Copperleaf Bakery', amount: 2100, due: 14, status: 'draft' },
      { id: 'INV-1046', company: 'Harbor Lights Co.', amount: 3300, due: 0, status: 'paid' },
    ],
  },
};

export const companies = [...new Set(apps.crm.contacts.map((c) => c.company))];

export const eur = (n) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
