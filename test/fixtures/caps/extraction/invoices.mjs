// Five fictional invoices for the real check (scripts/cap-real/extraction.mjs): the PDFs come from `pdf()`, the photos in ./images were
// made from them once (pdftoppm -r 100, then ImageMagick: rotated 3°, blurred 0x0.6, JPEG quality 70). Every name is invented.
export const INVOICES = Object.freeze([
  { id: 'atelier-imaginaire', lines: ['FACTURE No F-2026-0042', 'Atelier Imaginaire SARL', 'Date : 14/10/2026', 'Total TTC 1 234,56 EUR'], expect: { supplier: 'Atelier Imaginaire SARL', invoiceDate: '2026-10-14', total: 1234.56 } },
  { id: 'garage-martin', lines: ['Garage Martin', 'Facture 2026-311', 'Date : 12/11/2026', 'Vidange et filtres', 'Total TTC 240,00 EUR'], expect: { supplier: 'Garage Martin', invoiceDate: '2026-11-12', total: 240 } },
  { id: 'boulangerie-exemple', lines: ['Boulangerie Exemple', 'Ticket 0087', 'Date : 03/09/2026', 'Plateau petit-dejeuner x2', 'Total TTC 38,40 EUR'], expect: { supplier: 'Boulangerie Exemple', invoiceDate: '2026-09-03', total: 38.4 } },
  { id: 'cabinet-fictif', lines: ['Cabinet Fictif Conseil', 'Note d honoraires NH-118', 'Date : 21/08/2026', 'Mission de conseil', 'Total TTC 1 800,00 EUR'], expect: { supplier: 'Cabinet Fictif Conseil', invoiceDate: '2026-08-21', total: 1800 } },
  { id: 'imprimerie-test', lines: ['Imprimerie Test SAS', 'Facture IT-5521', 'Date : 30/07/2026', '500 cartes de visite', 'Total TTC 96,00 EUR'], expect: { supplier: 'Imprimerie Test SAS', invoiceDate: '2026-07-30', total: 96 } },
]);
export const SCHEMA = Object.freeze({ supplier: { type: 'string', description: 'the company that issued the invoice' }, invoiceDate: 'date', total: { type: 'amount', description: 'the total including VAT' } });
