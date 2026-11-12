import { fictionalPdf } from '../fictional-pdf.mjs';

// The demo's files (`?demo=1`), made in memory on first read, all invented French bookkeeping content: what `agent.files.read` hands the pane's
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
  g.fillStyle = '#1f2937'; g.font = 'bold 28px sans-serif'; g.fillText('Garage du Port', 40, 70);
  g.font = '20px sans-serif';
  ['Ticket n° 0901-17 (fictif)', '09/01/2026  14:32', '', 'Vidange et filtre      84,50 €', 'Essuie-glaces          12,00 €', '', 'Total TTC             96,50 €', 'Payé par carte'].forEach((line, i) => g.fillText(line, 40, 140 + i * 36));
  g.strokeStyle = '#9ca3af'; g.setLineDash([6, 6]); g.strokeRect(20, 20, w - 40, h - 40);
}).toBlob(blob => blob ? resolve(blob) : reject(new Error('canvas')), 'image/png'));

async function visit() {
  if (!RealRecorder) throw new Error('pas de vidéo ici');
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
    g.fillStyle = '#0c4a6e'; g.font = '18px sans-serif'; g.fillText('Atelier Brun : visite (fictive)', 20, 80); g.fillText(`plan ${frame + 1}`, 20, 110);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  recorder.stop();
  await done;
  return new Blob(chunks, { type: 'video/webm' });
}

const RELEVE_JANVIER = [['Relevé de compte · janvier 2026', 'Atelier Brun SARL (fictif)', '02/01 Virement Maison Delorme 1 240,00', '03/01 Prélèvement EDF Pro -186,40'],
  ['Relevé de compte · page 2', '28/01 Virement Cabinet Roux 1 980,00', '30/01 Frais de tenue de compte -14,50', 'Solde au 31/01 : 8 412,10']];
const MAKERS = {
  'uploads/releve-janvier.pdf': () => pdf(RELEVE_JANVIER),
  'uploads/releve-fevrier.pdf': () => pdf([['Relevé de compte · février 2026', 'Atelier Brun SARL (fictif)', '03/02 Prélèvement EDF Pro -191,20'], ['Relevé de compte · page 2', 'Solde au 28/02 : 9 006,40']]),
  'uploads/ecarts-janvier.csv': () => text('Date;Libellé;Écart;Statut\n09/01;Carte Garage du Port;"12,00 €";À justifier\n15/01;Carte Restaurant Le Cèdre;"-12,00 €";À justifier\n', 'text/csv'),
  'factures/facture-delorme-0112.pdf': () => pdf([['Facture 0112 · Maison Delorme (fictive)', 'Prestation de conseil 1 050,00', 'Total TTC 1 368,00']]),
  'factures/facture-axiom-0108.pdf': () => pdf([['Facture 0108 · Assurance Axiom (fictive)', 'Prime mensuelle 212,00']]),
  'factures/facture-brun-0121.pdf': () => pdf([['Facture 0121 · Brun & Fils (fictive)', 'Travaux atelier 1 150,00', 'Échéance 20/02/2026']]),
  'notes-cloture.md': () => text('# Notes de clôture\n\nDossier **Atelier Brun SARL**, exercice 2025 (fictif).\n\n- Justifier les deux écarts de janvier.\n- Relancer Brun & Fils pour la facture du 21/01 : 1 150,00 €.\n- Vérifier le remboursement URSSAF de 312,00 €.\n\n## Prochaine étape\n\nEnvoyer le dossier avant le 15 février.\n', 'text/markdown'),
  'justificatifs/recu-garage-0901.pdf': () => pdf([['Reçu · Garage du Port (fictif)', 'Ticket 0901-17 du 09/01/2026', 'Total TTC 96,50'], ['Conditions', 'Garantie pièces : 12 mois']]),
  'justificatifs/note-ecart-0901.md': () => text('# Écart du 09/01\n\nLa carte a débité **96,50 €** ; l’écriture porte **84,50 €**.\n\n- Écart : 12,00 € (essuie-glaces, ticket séparé).\n- À faire : ajouter la ligne au journal des achats.\n', 'text/markdown'),
  'justificatifs/ticket-garage-0901.png': receipt,
  'exports/ecritures-janvier.json': () => text(JSON.stringify({ journal: 'Banque', mois: '2026-01', lignes: [{ date: '09/01', libelle: 'Carte Garage du Port', montant: -96.5 }, { date: '15/01', libelle: 'Carte Restaurant Le Cèdre', montant: -58.2 }] }, null, 2), 'application/json'),
  'exports/rappel-delorme.txt': () => text('Bonjour,\n\nLa facture 0112 de Maison Delorme (1 368,00 € TTC) reste ouverte.\nPouvez-vous nous confirmer la date de règlement ?\n\nCordialement,\nAtelier Brun\n', 'text/plain'),
  'videos/visite-atelier.webm': visit,
};
export const DEMO_FILES = Object.keys(MAKERS);
/** The attachments of the line detail opened from the page (the 09/01 gap): a receipt PDF, a note and the photo of the ticket. */
export const ATTACHMENTS = ['justificatifs/recu-garage-0901.pdf', 'justificatifs/note-ecart-0901.md', 'justificatifs/ticket-garage-0901.png'];

const made = new Map();
export const demoFiles = {
  read: async path => {
    window.__reads = (window.__reads ?? 0) + 1;
    const make = MAKERS[path];
    if (!make) throw new Error(`introuvable : ${path}`);
    if (!made.has(path)) made.set(path, Promise.resolve().then(make));
    return { blob: await made.get(path), revision: 'r1' };
  },
};
