import { fictionalPdf } from '../fictional-pdf.mjs';

// The demo's files (`?demo=1`), made in memory on first read, all invented English bookkeeping content: what `agent.files.read` hands the pane's
// viewer. One of each kind the kit shows: PDFs of one and two pages, a CSV table, Markdown notes, a PNG receipt, a JSON export, a plain text and a
// short WebM. A read resolves `{ blob, revision }`, so the pane can acknowledge a `present`.
// The fixture swaps `window.MediaRecorder` for a fake microphone after this module runs: the real one is kept here to record the video.
const RealRecorder = typeof window === 'undefined' ? undefined : window.MediaRecorder;

const pdf = pages => new Blob([fictionalPdf(pages)], { type: 'application/pdf' });
const text = (body, type) => new Blob([body], { type });

function drawn(width, height, paint) {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  paint(canvas.getContext('2d'), width, height);
  return canvas;
}
const receipt = () => new Promise((resolve, reject) => drawn(480, 640, (g, w, h) => {
  g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f2937'; g.font = 'bold 28px sans-serif'; g.fillText('Harbor Garage', 40, 70);
  g.font = '20px sans-serif';
  ['Ticket no. 0109-17 (fictional)', '01/09/2026  14:32', '', 'Oil and filter change   $84.50', 'Wiper blades            $12.00', '', 'Total incl. tax        $96.50', 'Paid by card'].forEach((line, i) => g.fillText(line, 40, 140 + i * 36));
  g.strokeStyle = '#9ca3af'; g.setLineDash([6, 6]); g.strokeRect(20, 20, w - 40, h - 40);
}).toBlob(blob => blob ? resolve(blob) : reject(new Error('canvas')), 'image/png'));

async function visit() {
  if (!RealRecorder) throw new Error('no video here');
  const canvas = drawn(320, 180, () => {});
  const g = canvas.getContext('2d');
  const stream = canvas.captureStream(15);
  const recorder = new RealRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];
  recorder.ondataavailable = event => chunks.push(event.data);
  const done = new Promise(resolve => { recorder.onstop = resolve; });
  recorder.start();
  for (let frame = 0; frame < 18; frame += 1) {
    g.fillStyle = '#e0f2fe'; g.fillRect(0, 0, 320, 180);
    g.fillStyle = '#0c4a6e'; g.font = '18px sans-serif'; g.fillText('Harbor Studio: tour (fictional)', 20, 80); g.fillText(`shot ${frame + 1}`, 20, 110);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  recorder.stop();
  await done;
  return new Blob(chunks, { type: 'video/webm' });
}

const STATEMENT_JANUARY = [['Account statement · January 2026', 'Harbor Studio LLC (fictional)', 'Jan 02 Transfer Delmore House 1,240.00', 'Jan 03 Direct debit Northgrid Energy -186.40'],
  ['Account statement · page 2', 'Jan 28 Client transfer Rowan Partners 1,980.00', 'Jan 30 Account maintenance fee -14.50', 'Balance on Jan 31: 8,412.10']];
const MAKERS = {
  'uploads/statement-january.pdf': () => pdf(STATEMENT_JANUARY),
  'uploads/statement-february.pdf': () => pdf([['Account statement · February 2026', 'Harbor Studio LLC (fictional)', 'Feb 03 Direct debit Northgrid Energy -191.20'], ['Account statement · page 2', 'Balance on Feb 28: 9,006.40']]),
  'uploads/discrepancies-january.csv': () => text('Date;Label;Gap;Status\nJan 09;Card Harbor Garage;"$12.00";Needs a receipt\nJan 15;Card The Cedar Diner;"-$12.00";Needs a receipt\n', 'text/csv'),
  'invoices/invoice-delmore-0112.pdf': () => pdf([['Invoice 0112 · Delmore House (fictional)', 'Consulting 1,050.00', 'Total incl. tax 1,368.00']]),
  'invoices/invoice-axiom-0108.pdf': () => pdf([['Invoice 0108 · Axiom Insurance (fictional)', 'Monthly premium 212.00']]),
  'invoices/invoice-brown-0121.pdf': () => pdf([['Invoice 0121 · Brown & Sons (fictional)', 'Workshop work 1,150.00', 'Due Feb 20, 2026']]),
  'closing-notes.md': () => text('# Closing notes\n\nFile **Harbor Studio LLC**, fiscal year 2025 (fictional).\n\n- Justify the two January gaps.\n- Remind Brown & Sons about the invoice of Jan 21: $1,150.00.\n- Check the payroll tax refund of $312.00.\n\n## Next step\n\nSend the file before February 15.\n', 'text/markdown'),
  'receipts/receipt-harbor-garage-0109.pdf': () => pdf([['Receipt · Harbor Garage (fictional)', 'Ticket 0109-17 of Jan 9, 2026', 'Total incl. tax 96.50'], ['Terms', 'Parts warranty: 12 months']]),
  'receipts/note-gap-0109.md': () => text('# Gap of Jan 9\n\nThe card was charged **$96.50**; the entry shows **$84.50**.\n\n- Gap: $12.00 (wiper blades, separate ticket).\n- To do: add the line to the purchases journal.\n', 'text/markdown'),
  'receipts/ticket-harbor-garage-0109.png': receipt,
  'exports/entries-january.json': () => text(JSON.stringify({ journal: 'Bank', month: '2026-01', lines: [{ date: 'Jan 09', label: 'Card Harbor Garage', amount: -96.5 }, { date: 'Jan 15', label: 'Card The Cedar Diner', amount: -58.2 }] }, null, 2), 'application/json'),
  'exports/reminder-delmore.txt': () => text('Hello,\n\nInvoice 0112 from Delmore House ($1,368.00 incl. tax) is still open.\nCould you confirm the payment date?\n\nKind regards,\nHarbor Studio\n', 'text/plain'),
  'videos/studio-tour.webm': visit,
};
export const DEMO_FILES = Object.keys(MAKERS);
/** The attachments of the line detail opened from the page (the Jan 9 gap): a receipt PDF, a note and the photo of the ticket. */
export const ATTACHMENTS = ['receipts/receipt-harbor-garage-0109.pdf', 'receipts/note-gap-0109.md', 'receipts/ticket-harbor-garage-0109.png'];

const made = new Map();
export const demoFiles = {
  read: async path => {
    window.__reads = (window.__reads ?? 0) + 1;
    const make = MAKERS[path];
    if (!make) throw new Error(`not found: ${path}`);
    if (!made.has(path)) made.set(path, Promise.resolve().then(make));
    return { blob: await made.get(path), revision: 'r1' };
  },
};
