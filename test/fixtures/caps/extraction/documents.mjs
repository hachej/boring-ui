// Fictional documents for the extraction tests, ported from boring-factory services/extract/fixtures (documents.mjs, double.mjs and the
// Mistral answers of adapters/mistral/fixture.mjs, written from Mistral's documented shape, not from a live call). The invoice is invented
// (Atelier Imaginaire SARL, Cabinet Fictif). The PDFs are real, minimal PDFs (one Helvetica text page per entry).

export const INVOICE_LINES = Object.freeze([
  'FACTURE No F-2026-0042', 'Atelier Imaginaire SARL', '12 rue des Exemples, 75000 Paris', 'Date : 14/10/2026',
  'Client : Cabinet Fictif', 'Prestation de conseil 1 028,80 EUR', 'TVA 20 % 205,76 EUR', 'Total TTC 1 234,56 EUR',
]);
export const INVOICE_TEXT = INVOICE_LINES.join('\n');
export const INVOICE_SCHEMA = Object.freeze({
  supplier: { type: 'string', description: 'the company that issued the invoice' },
  invoiceNumber: 'string',
  invoiceDate: 'date',
  total: { type: 'amount', description: 'the total including VAT' },
});
export const INVOICE_FIELDS = Object.freeze({ supplier: 'Atelier Imaginaire SARL', invoiceNumber: 'F-2026-0042', invoiceDate: '2026-10-14', total: 1234.56 });
export const QUOTES = Object.freeze({ supplier: 'Atelier Imaginaire SARL', invoiceNumber: 'FACTURE No F-2026-0042', invoiceDate: 'Date : 14/10/2026', total: 'Total TTC | 1 234,56 EUR' });

const ascii = (s) => s.replace(/€/g, 'EUR').replace(/°/g, 'o').replace(/[\\()]/g, (c) => `\\${c}`);
/** A minimal valid PDF: one page per entry of `pages` (each a list of lines; an empty list is a page with no text layer, a scan). `encrypt`: a Standard security handler whose user password is not empty. */
export function pdf(pages, { encrypt = false } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const lines of pages) {
    const content = `BT /F1 12 Tf 72 760 Td 16 TL ${lines.map((l) => `(${ascii(l)}) Tj T*`).join(' ')} ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const contentId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  if (encrypt) objects.push(`<< /Filter /Standard /V 1 /R 2 /O <${'1a'.repeat(32)}> /U <${'2b'.repeat(32)}> /P -4 >>`);
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  const secure = encrypt ? ` /Encrypt ${objects.length} 0 R /ID [<${'3c'.repeat(16)}> <${'3c'.repeat(16)}>]` : '';
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${secure} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export const INVOICE_PDF = pdf([INVOICE_LINES]);
/** A 1x1 PNG: the bytes of an image; the double reads it as the invoice photographed. */
export const INVOICE_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
export const pagesPdf = (n, scanned = []) => pdf(Array.from({ length: n }, (_, i) => (scanned.includes(i + 1) ? [] : [`Page ${i + 1} (fictional)`])));

export const MARKDOWN = [
  '# FACTURE No F-2026-0042', '', 'Atelier Imaginaire SARL', '', '12 rue des Exemples, 75000 Paris', '', 'Date : 14/10/2026', '',
  'Client : Cabinet Fictif', '', '| Prestation de conseil | 1 028,80 EUR |', '| --- | --- |', '| TVA 20 % | 205,76 EUR |', '| Total TTC | 1 234,56 EUR |',
].join('\n');
export const ANNOTATION = Object.freeze(Object.fromEntries(Object.entries(INVOICE_FIELDS).map(([name, value]) => [name, { value, page: 1, quote: QUOTES[name] }])));
/** The Factory's tampered reading: a total whose quote is not on the page, a supplier without its quote. */
export const TAMPERED = Object.freeze({ ...ANNOTATION, total: { value: 9999, page: 1, quote: 'Total TTC 9 999,00 EUR' }, supplier: { value: 'Atelier Imaginaire SARL', page: 1, quote: null } });

/**
 * A local double of POST https://api.mistral.ai/v1/ocr that records every request. It answers the asked pages (`pages`, 0-based; page 0
 * alone without it) with `markdown(index)` (the invoice by default), the page confidence `confidence`, and the annotation when one is asked.
 * `status` other than 200 answers that status and echoes the Authorization header back, the worst a provider could do; `raw` answers that text.
 */
export function mistralDouble({ status = 200, raw, annotation = ANNOTATION, confidence = 0.97, markdown = () => MARKDOWN } = {}) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body, authorization: init.headers?.authorization });
    if (status !== 200) return new Response(`echo ${init.headers?.authorization ?? ''}`, { status });
    if (raw !== undefined) return new Response(raw, { status: 200 });
    const indexes = body.pages ?? [0];
    return Response.json({
      pages: indexes.map((index) => ({ index, markdown: markdown(index), images: [], dimensions: { dpi: 200, height: 2339, width: 1654 }, confidence_scores: { average_page_confidence_score: confidence, minimum_page_confidence_score: 0.83 } })),
      model: 'mistral-ocr-2512', document_annotation: body.document_annotation_format ? JSON.stringify(annotation) : null, usage_info: { pages_processed: indexes.length, doc_size_bytes: 1834 },
    });
  };
  return { fetch, requests };
}
