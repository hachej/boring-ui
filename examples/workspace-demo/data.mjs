// Fictional data for the accounts-payable demo: a company, its suppliers, invoices and two Library documents. Invented names and
// amounts only. PDFs are generated here (a one-page text PDF), so no binary fixture is committed.
export const COMPANY = 'Harbor & Pine Foods';
export const ACCOUNTS = ['6100 Packaging', '6200 Printing', '6300 Marketing', '6400 Facilities'];

export const SUPPLIERS = {
  'linden-print': { id: 'linden-print', name: 'Linden Print Co', country: 'FR', terms: 'Net 30', iban: 'FR76 •••• 4821', openBalance: 2568.0, flag: 'Two invoices share a PO and an amount.',
    contract: 'Contracts/linden-print-agreement.pdf' },
  'north-quay': { id: 'north-quay', name: 'North Quay Logistics', country: 'GB', terms: 'Net 45', iban: 'GB29 •••• 0113', openBalance: 7410.5, flag: undefined, contract: 'Contracts/north-quay-agreement.pdf' },
  'fernhill-labels': { id: 'fernhill-labels', name: 'Fernhill Labels', country: 'DE', terms: 'Net 30', iban: 'DE89 •••• 7720', openBalance: 960.0, flag: undefined, contract: 'Contracts/fernhill-agreement.pdf' },
  'willow-pack': { id: 'willow-pack', name: 'Willow Packaging', country: 'NL', terms: 'Net 30', iban: 'NL91 •••• 3810', contract: 'Contracts/willow-pack-agreement.pdf' },
  'cedar-office': { id: 'cedar-office', name: 'Cedar Office Supply', country: 'BE', terms: 'Net 30', iban: 'BE68 •••• 2940', contract: 'Contracts/cedar-office-agreement.pdf' },
  'moss-studio': { id: 'moss-studio', name: 'Moss Design Studio', country: 'FR', terms: 'Net 14', iban: 'FR14 •••• 6803', contract: 'Contracts/moss-studio-agreement.pdf' },
  'stoneworks': { id: 'stoneworks', name: 'Stoneworks Maintenance', country: 'DE', terms: 'Net 30', iban: 'DE52 •••• 9102', contract: 'Contracts/stoneworks-agreement.pdf' },
};

export const BUDGETS = [
  { account: '6100 Packaging', limit: 18000, goal: 'Reduce packaging waste', saved: 3200, target: 5000 },
  { account: '6200 Printing', limit: 10000, goal: 'Move catalogues to recycled stock', saved: 1800, target: 3000 },
  { account: '6300 Marketing', limit: 15000, goal: 'Spring launch reserve', saved: 7600, target: 12000 },
  { account: '6400 Facilities', limit: 12000, goal: 'Warehouse energy upgrade', saved: 4100, target: 8000 },
];

// `due` is the payment due date; `week` marks the invoices that wait for approval this week.
export const INVOICES = [
  { id: 'INV-2041', supplier: 'linden-print', number: 'LP-7710', po: 'PO-771', date: '2031-03-04', due: '2031-04-03', amount: 1284.0, currency: 'EUR', account: '6200 Printing', status: 'pending', week: true, description: 'Spring catalogue, 5,000 copies' },
  { id: 'INV-2043', supplier: 'linden-print', number: 'LP-7710-B', po: 'PO-771', date: '2031-03-06', due: '2031-04-05', amount: 1284.0, currency: 'EUR', account: '6200 Printing', status: 'pending', week: true, description: 'Spring catalogue, 5,000 copies' },
  { id: 'INV-2044', supplier: 'north-quay', number: 'NQ-30192', po: 'PO-802', date: '2031-03-05', due: '2031-04-19', amount: 3120.5, currency: 'EUR', account: '6400 Facilities', status: 'pending', week: true, description: 'March pallet deliveries' },
  { id: 'INV-2039', supplier: 'fernhill-labels', number: 'FL-5521', po: 'PO-760', date: '2031-02-26', due: '2031-03-28', amount: 960.0, currency: 'EUR', account: '6100 Packaging', status: 'approved', week: false, description: 'Jar labels, 20,000' },
  ...Array.from({ length: 16 }, (_, index) => ({
    id: `INV-${2050 + index}`, supplier: Object.keys(SUPPLIERS)[index % 7], number: `BILL-${8800 + index}`, po: `PO-${900 + index}`,
    date: `2031-03-${String(10 + index).padStart(2, '0')}`, due: `2031-04-${String(10 + index).padStart(2, '0')}`,
    amount: [2150, 780, 3400, 1620, 540, 2875, 1950, 4200, 680, 1250, 890, 3100, 2340, 1750, 460, 5280][index],
    currency: 'EUR', account: ACCOUNTS[index % 4], status: index % 5 === 0 ? 'on-hold' : index % 3 === 0 ? 'pending' : 'approved', week: false,
    description: ['Recyclable shipping boxes', 'Seasonal label run', 'Warehouse servicing', 'Product photography', 'Office supplies', 'Delivery and handling', 'Point-of-sale materials'][index % 7],
  })),
];

export const POLICY = `# Accounts payable policy

Applies to every supplier invoice at ${COMPANY}.

## 1. Approval limits

- Up to 1,000 EUR: one approver.
- Above 1,000 EUR: one approver and a check that the invoice number and PO are new.
- Above 5,000 EUR: a second approver.

## 2. Duplicates

An invoice with the same supplier, PO and amount as an open invoice is held until the first one is paid or rejected.

## 3. Coding

Each invoice is coded to one expense account. A re-code needs a short reason in the approval note.
`;

/** Tiny text-only PDF (Helvetica, one page). Enough for a viewer to open; the lines are plain ASCII. */
export function pdf(lines) {
  const esc = text => text.replace(/[()\\]/g, '\\$&');
  const content = ['BT /F1 12 Tf 56 780 Td 16 TL', ...lines.map(line => `(${esc(line)}) Tj T*`), 'ET'].join('\n');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((body, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export const invoicePdf = invoice => {
  const supplier = SUPPLIERS[invoice.supplier];
  return pdf([supplier.name.toUpperCase(), '', `Invoice ${invoice.number}`, `Date: ${invoice.date}`, `PO: ${invoice.po}`, `Bill to: ${COMPANY}`, '', invoice.description,
    '', `Total due: ${invoice.amount.toFixed(2)} ${invoice.currency}`, `Payment terms: ${supplier.terms}`]);
};
export const contractPdf = supplier => pdf([`SUPPLY AGREEMENT - ${supplier.name.toUpperCase()}`, '', `Between ${supplier.name} and ${COMPANY}.`, `Payment terms: ${supplier.terms}.`,
  'Invoices must quote a purchase order number.', 'Duplicate invoices are credited within 14 days.']);
