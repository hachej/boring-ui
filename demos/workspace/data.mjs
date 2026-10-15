// Fictional data for the accounts-payable demo: a company, its suppliers, invoices and two Library documents. Invented names and
// amounts only. PDFs are generated here (a one-page text PDF), so no binary fixture is committed.
export const COMPANY = 'Harbor & Pine Foods';
export const ACCOUNTS = ['6100 Packaging', '6200 Printing', '6300 Marketing', '6400 Facilities', '6500 IT and software', '6600 Fuel and vehicles'];
/** The demo's "today": every date in the data is relative to it, so the tables and the dashboard read the same on any day. */
export const TODAY = '2031-03-07';

export const SUPPLIERS = {
  'linden-print': { id: 'linden-print', name: 'Linden Print Co', country: 'FR', terms: 'Net 30', iban: 'FR76 •••• 4821', openBalance: 2568.0, flag: 'Two invoices share a PO and an amount.',
    contract: 'Contracts/linden-print-agreement.pdf' },
  'north-quay': { id: 'north-quay', name: 'North Quay Logistics', country: 'GB', terms: 'Net 45', iban: 'GB29 •••• 0113', openBalance: 7410.5, flag: undefined, contract: 'Contracts/north-quay-agreement.pdf' },
  'fernhill-labels': { id: 'fernhill-labels', name: 'Fernhill Labels', country: 'DE', terms: 'Net 30', iban: 'DE89 •••• 7720', openBalance: 960.0, flag: undefined, contract: 'Contracts/fernhill-agreement.pdf' },
  'alder-packaging': { id: 'alder-packaging', name: 'Alder Packaging Ltd', country: 'GB', terms: 'Net 30', iban: 'GB82 •••• 5540', openBalance: 842.1, flag: undefined, contract: 'Contracts/alder-packaging-agreement.pdf' },
  'brook-cleaning': { id: 'brook-cleaning', name: 'Brook & Sons Cleaning', country: 'IE', terms: 'Net 14', iban: 'IE29 •••• 3320', openBalance: 1180.0, flag: 'One invoice is past its due date.', contract: 'Contracts/brook-cleaning-agreement.pdf' },
  'cedar-it': { id: 'cedar-it', name: 'Cedar IT Services', country: 'NL', terms: 'Net 30', iban: 'NL91 •••• 0417', openBalance: 2150.0, flag: undefined, contract: 'Contracts/cedar-it-agreement.pdf' },
  'dunmore-fuel': { id: 'dunmore-fuel', name: 'Dunmore Fuel Cards', country: 'GB', terms: 'Net 15', iban: 'GB33 •••• 6125', openBalance: 1390.4, flag: 'Fuel card statement is on hold pending a query.', contract: 'Contracts/dunmore-fuel-agreement.pdf' },
};

// `due` is the payment due date; `week` marks the invoices that wait for approval this week.
export const INVOICES = [
  { id: 'INV-2041', supplier: 'linden-print', number: 'LP-7710', po: 'PO-771', date: '2031-03-04', due: '2031-04-03', amount: 1284.0, currency: 'EUR', account: '6200 Printing', status: 'pending', week: true, description: 'Spring catalogue, 5,000 copies' },
  { id: 'INV-2043', supplier: 'linden-print', number: 'LP-7710-B', po: 'PO-771', date: '2031-03-06', due: '2031-04-05', amount: 1284.0, currency: 'EUR', account: '6200 Printing', status: 'pending', week: true, description: 'Spring catalogue, 5,000 copies' },
  { id: 'INV-2044', supplier: 'north-quay', number: 'NQ-30192', po: 'PO-802', date: '2031-03-05', due: '2031-04-19', amount: 3120.5, currency: 'EUR', account: '6400 Facilities', status: 'pending', week: true, description: 'March pallet deliveries' },
  { id: 'INV-2039', supplier: 'fernhill-labels', number: 'FL-5521', po: 'PO-760', date: '2031-02-26', due: '2031-03-28', amount: 960.0, currency: 'EUR', account: '6100 Packaging', status: 'approved', week: false, description: 'Jar labels, 20,000' },
  // Earlier and later invoices, so the tables and the dashboard read like a real week. `paidOn` marks a paid invoice.
  { id: 'INV-2021', supplier: 'fernhill-labels', number: 'FL-5410', po: 'PO-741', date: '2031-01-14', due: '2031-02-13', amount: 1120.0, currency: 'EUR', account: '6100 Packaging', status: 'approved', paidOn: '2031-02-12', week: false, description: 'Lid labels, 25,000' },
  { id: 'INV-2023', supplier: 'north-quay', number: 'NQ-29877', po: 'PO-790', date: '2031-01-31', due: '2031-03-17', amount: 2890.0, currency: 'EUR', account: '6400 Facilities', status: 'approved', paidOn: '2031-03-03', week: false, description: 'January pallet deliveries' },
  { id: 'INV-2025', supplier: 'cedar-it', number: 'CIT-0377', po: 'PO-798', date: '2031-02-01', due: '2031-03-03', amount: 2150.0, currency: 'EUR', account: '6500 IT and software', status: 'approved', paidOn: '2031-03-02', week: false, description: 'Managed workplace, February' },
  { id: 'INV-2027', supplier: 'alder-packaging', number: 'AP-9810', po: 'PO-801', date: '2031-02-05', due: '2031-03-07', amount: 1560.75, currency: 'EUR', account: '6100 Packaging', status: 'approved', paidOn: '2031-03-05', week: false, description: 'Cardboard trays, 8,000' },
  { id: 'INV-2029', supplier: 'dunmore-fuel', number: 'DF-66120', po: 'PO-803', date: '2031-02-08', due: '2031-02-23', amount: 1275.4, currency: 'EUR', account: '6600 Fuel and vehicles', status: 'approved', paidOn: '2031-02-21', week: false, description: 'Fuel cards, early February' },
  { id: 'INV-2031', supplier: 'brook-cleaning', number: 'BS-3318', po: 'PO-805', date: '2031-02-12', due: '2031-02-26', amount: 590.0, currency: 'EUR', account: '6400 Facilities', status: 'approved', paidOn: '2031-02-25', week: false, description: 'Office cleaning, first half of February' },
  { id: 'INV-2033', supplier: 'brook-cleaning', number: 'BS-3341', po: 'PO-805', date: '2031-02-26', due: '2031-03-02', amount: 590.0, currency: 'EUR', account: '6400 Facilities', status: 'approved', week: false, description: 'Office cleaning, second half of February' },
  { id: 'INV-2034', supplier: 'linden-print', number: 'LP-7655', po: 'PO-742', date: '2031-02-02', due: '2031-03-04', amount: 684.0, currency: 'EUR', account: '6200 Printing', status: 'approved', week: false, description: 'Price lists, 2,000 copies' },
  { id: 'INV-2036', supplier: 'dunmore-fuel', number: 'DF-66488', po: 'PO-809', date: '2031-02-24', due: '2031-03-11', amount: 1390.4, currency: 'EUR', account: '6600 Fuel and vehicles', status: 'on-hold', week: false, description: 'Fuel cards, late February' },
  { id: 'INV-2038', supplier: 'north-quay', number: 'NQ-30044', po: 'PO-795', date: '2031-02-25', due: '2031-04-11', amount: 4290.0, currency: 'EUR', account: '6400 Facilities', status: 'approved', week: false, description: 'February pallet deliveries' },
  { id: 'INV-2040', supplier: 'cedar-it', number: 'CIT-0402', po: 'PO-811', date: '2031-03-01', due: '2031-03-31', amount: 2150.0, currency: 'EUR', account: '6500 IT and software', status: 'approved', week: false, description: 'Managed workplace, March' },
  { id: 'INV-2042', supplier: 'fernhill-labels', number: 'FL-5588', po: 'PO-812', date: '2031-03-03', due: '2031-04-02', amount: 1320.0, currency: 'EUR', account: '6100 Packaging', status: 'pending', week: false, description: 'Seasonal labels, 30,000' },
  { id: 'INV-2045', supplier: 'alder-packaging', number: 'AP-9921', po: 'PO-815', date: '2031-03-06', due: '2031-04-05', amount: 842.1, currency: 'EUR', account: '6100 Packaging', status: 'pending', week: false, description: 'Shipping cartons, 3,000' },
  { id: 'INV-2046', supplier: 'cedar-it', number: 'CIT-0419', po: 'PO-816', date: '2031-03-06', due: '2031-04-05', amount: 480.0, currency: 'EUR', account: '6500 IT and software', status: 'pending', week: false, description: 'Laptop accessories' },
  { id: 'INV-2047', supplier: 'brook-cleaning', number: 'BS-3362', po: 'PO-818', date: '2031-03-07', due: '2031-03-21', amount: 590.0, currency: 'EUR', account: '6400 Facilities', status: 'pending', week: false, description: 'Office cleaning, first half of March' },
];

/** What a table shows for an invoice: the backend's `status`, plus paid (has `paidOn`) and overdue (approved, unpaid, past due). */
export function displayStatus(invoice) {
  if (invoice.paidOn) return 'paid';
  if (invoice.status === 'approved' && invoice.due < TODAY) return 'overdue';
  return invoice.status;
}

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
