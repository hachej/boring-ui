import { useMemo, useState } from 'react';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { FileTreeView } from '../../../registry/file-tree/file-tree.tsx';

// The UX demo layer (`?demo=1`, UX loop): what a person does with the one composer, over invented French bookkeeping content:
// a library (the kit's FileTreeView over an in-memory provider), earlier conversations (the chat's History list), a long conversation,
// a record opened from a page row, a quote from the page. Nothing here changes the default fixture page.
export const DEMO = new URLSearchParams(location.search).get('demo') === '1';

const TREE = {
  '': [['uploads', 'directory'], ['factures', 'directory'], ['notes-cloture.md', 'file', 2400]],
  uploads: [['releve-janvier.pdf', 'file', 84000], ['releve-fevrier.pdf', 'file', 79000], ['ecarts-janvier.csv', 'file', 900]],
  factures: [['facture-delorme-0112.pdf', 'file', 41000], ['facture-axiom-0108.pdf', 'file', 38000], ['facture-brun-0121.pdf', 'file', 40500]],
};
const ALL = Object.entries(TREE).flatMap(([dir, rows]) => rows.filter(row => row[1] === 'file').map(([name, kind, size]) => ({ path: dir ? `${dir}/${name}` : name, kind, size })));
const provider = {
  identity: { scopeId: 'demo', principalId: 'julie', initiatorId: 'julie' }, workspace: { providerId: 'demo', instanceId: 'one', incarnation: 'one', viewId: 'one' },
  locate: path => ({ resource: { providerId: 'demo', path }, view: { kind: 'published' } }),
  list: async ({ directory = '' } = {}) => ({ entries: (TREE[directory] ?? []).map(([name, kind, size = 1000]) => ({ path: directory ? `${directory}/${name}` : name, kind, size })) }),
  search: async ({ query }) => ({ entries: ALL.filter(entry => entry.path.toLowerCase().includes(String(query).toLowerCase())) }),
  history: async () => [], read: async () => { throw new Error('indisponible'); }, publish: async () => { throw new Error('indisponible'); }, lookup: async () => undefined,
};
let tree;
export const demoLibrary = open => onPicked => {
  tree ??= createFileTreeController({ revisionProvider: provider });
  void tree.refresh();
  return <div data-testid="fixture-library"><FileTreeView controller={tree} locale="fr" upload={false} history={false} onOpen={path => { open(path); onPicked(); }} /></div>;
};

const Table = ({ head, rows }) => <table className="w-full border-collapse text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground">{head.map((cell, i) => <th key={cell} className={`py-1 ${i === head.length - 1 ? 'text-right' : ''}`}>{cell}</th>)}</tr></thead>
  <tbody>{rows.map(row => <tr key={row.join()} className="border-b last:border-b-0">{row.map((cell, i) => <td key={i} className={`py-2 ${i === row.length - 1 ? 'text-right tabular-nums' : ''}`}>{cell}</td>)}</tr>)}</tbody></table>;
export const fileView = path => {
  const name = path.split('/').at(-1);
  const body = name.endsWith('.csv') ? <><Table head={['Date', 'Libellé', 'Écart']} rows={[['09/01', 'Carte Garage du Port', '12,00 €'], ['15/01', 'Carte Restaurant Le Cèdre', '−12,00 €']]} /><p className="text-muted-foreground">Deux écarts à justifier avant la clôture.</p></>
    : name.startsWith('releve') ? <><p className="text-muted-foreground">Relevé bancaire · Atelier Brun SARL</p><Table head={['Date', 'Libellé', 'Montant']} rows={[['02/01', 'Virement Maison Delorme', '1 240,00 €'], ['03/01', 'Prélèvement EDF Pro', '−186,40 €'], ['05/01', 'Carte Papeterie Lemaire', '−42,90 €'], ['06/01', 'Virement client Atelier Brun', '2 880,00 €']]} /></>
    : name.startsWith('facture') ? <><p className="font-medium">Facture {name.replace('.pdf', '').split('-').at(-1)}</p><Table head={['Désignation', 'Qté', 'Total HT']} rows={[['Prestation de conseil', '3', '1 050,00 €'], ['Déplacement', '1', '90,00 €']]} /><p className="text-right font-medium">Total TTC : 1 368,00 €</p></>
    : <><p className="font-medium">Notes de clôture</p><ul className="list-disc pl-5"><li>Justifier les deux écarts de janvier.</li><li>Relancer Brun &amp; Fils pour la facture du 21/01.</li><li>Vérifier le remboursement URSSAF.</li></ul></>;
  return { title: name, content: <div data-testid="fixture-preview" className="flex flex-col gap-3 p-4 text-sm"><p className="font-medium">{name}</p>{body}</div> };
};
export const recordView = ([date, label, amount, status], quote) => ({ title: `Écriture du ${date}`, content: <div data-testid="fixture-record" className="flex flex-col gap-3 p-4 text-sm">
  <p className="text-base font-medium">{label}</p><p className="text-2xl font-semibold tabular-nums">{amount}</p><p className="text-muted-foreground">Statut : {{ ok: 'rapprochée', gap: 'écart à justifier', wait: 'à justifier' }[status]}</p>
  <button type="button" data-testid="record-quote" className="h-10 self-start rounded-md border px-3" onClick={quote}>Citer dans l’assistant</button></div> });

const say = (id, text) => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] });
const answer = (id, text) => ({ id, kind: 'message', byTaskId: 7, model: [{ role: 'assistant', content: [{ type: 'text', text }], api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 2 }] });
const QA = [['Combien de lignes restent à rapprocher ?', 'Trois lignes restent : deux écarts et un remboursement URSSAF à justifier.'], ['Quel est le solde de la banque ?', 'Le solde est de 8 412,10 € au 31 janvier.'], ['Quelles factures sont en retard ?', 'La facture Brun & Fils du 21/01 (1 150,00 €) est en attente depuis 19 jours.'],
  ['Prépare une relance pour Brun & Fils.', 'Voici un brouillon : « Bonjour, la facture du 21 janvier reste ouverte. Pouvez-vous nous confirmer la date de règlement ? »'], ['Et pour l’assurance Axiom ?', 'Le prélèvement de 212,00 € du 08/01 est rapproché, rien à faire.'], ['Résume les écarts de janvier.', 'Deux écarts de 12,00 € : Garage du Port (09/01) et Restaurant Le Cèdre (15/01).']];
const longConversation = () => Array.from({ length: 22 }, (_, i) => [say(100 + i * 2, `${QA[i % QA.length][0]} (${i + 1})`), answer(101 + i * 2, `${QA[i % QA.length][1]} Point ${i + 1} sur 22 de la clôture annuelle.`)]).flat();
export const CONVERSATIONS = {
  cedre: { title: 'Dossier Cèdre', last: 'Le dossier Cèdre fictif attend deux pièces.' },
  long: { title: 'Clôture annuelle 2025', last: 'Point 22 sur 22 de la clôture annuelle.', entries: longConversation() },
  tva: { title: 'TVA du trimestre', last: 'La TVA collectée est de 4 120,00 €.', entries: [say(300, 'Calcule la TVA collectée du trimestre.'), answer(301, 'La TVA collectée est de 4 120,00 €, déductible 1 735,00 €.')] },
  relance: { title: 'Relances clients de décembre', last: 'Trois relances sont prêtes.', entries: [say(310, 'Prépare les relances de décembre.'), answer(311, 'Trois relances sont prêtes : Brun & Fils, Maison Delorme, Cabinet Roux.')] },
  ecarts: { title: 'Écarts de novembre', last: 'Les écarts sont soldés.', entries: [say(320, 'Où en sont les écarts de novembre ?'), answer(321, 'Les écarts sont soldés.')] },
};
const NOW = Date.now();
const listItems = extra => [...extra, ...Object.entries(CONVERSATIONS).map(([id, c], i) => ({ id, title: c.title, lastMessage: c.last, updatedAt: NOW - (i + 1) * 3600e3 * 7 }))];
// The app root with the conversation list: History lists them, a pick opens one, New starts an empty one. `show(entries)` swaps the controller's transcript.
export function useDemoConversations(show, cedre) {
  const [active, setActive] = useState('cedre');
  const [fresh, setFresh] = useState([]);
  return useMemo(() => DEMO ? { conversations: { items: listItems(fresh), activeId: active,
    onSelect: id => { setActive(id); show(id === 'cedre' ? cedre : (CONVERSATIONS[id]?.entries ?? [])); },
    onNew: () => { const id = `new-${fresh.length + 1}`; setFresh([{ id, title: 'Nouvelle conversation', lastMessage: '', updatedAt: Date.now() }, ...fresh]); setActive(id); show([]); } } } : {}, [active, fresh, show, cedre]);
}
