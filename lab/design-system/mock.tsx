/*
 * The gallery's mock providers: a fake chat controller, an in-memory resource client and fictional French small-business fixtures.
 * Every shape follows the kit's public types (ChatController, ResourceClient); nothing here is a block, and no block is edited for it.
 * Fictional data only: Atelier Lumen, Maison Orme, Studio Vallon and Boulangerie Ferrand are invented, and every address is example.test.
 */
import { publicationDigest } from '@hachej/boring-files/publication';
import type { PublicationRequest, PublicationResult, ReadResult, ResourceClient, ResourceLocator, ResourceRead, ResourceRef } from '@hachej/boring-files';
import type { ChatController, ChatSnapshot } from '@hachej/boring-ui-kit/native-chat';
import { createTaskListController } from '../../registry/task-list-viewer/task-list-controller';
import { emptyTaskList, serializeTaskList, taskListMediaType } from '../../registry/task-list-viewer/task-list-document';

/* ---------- chat ---------- */

type Entry = { readonly id: number; readonly kind: 'message'; readonly byTaskId?: number; readonly model: readonly unknown[] };
const T0 = Date.UTC(2026, 10, 4, 8, 30);
const user = (id: number, text: string): Entry => ({ id, kind: 'message', model: [{ role: 'user', content: text, timestamp: T0 + id * 60000 }] });
const assistant = (id: number, task: number, content: readonly unknown[], extra: Record<string, unknown> = {}): Entry => ({ id, kind: 'message', byTaskId: task,
  model: [{ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'atelier-1', usage: {}, stopReason: 'stop', timestamp: T0 + id * 60000, ...extra }] });
const toolResult = (id: number, task: number, callId: string, name: string, text: string): Entry => ({ id, kind: 'message', byTaskId: task,
  model: [{ role: 'toolResult', toolCallId: callId, toolName: name, isError: false, content: [{ type: 'text', text }], timestamp: T0 + id * 60000 }] });

export const lateInvoicesReply = `Deux factures sont en retard cette semaine :

- **F-2026-041**, Maison Orme, 388,00 € (12 jours)
- **F-2026-043**, Studio Vallon, 2 910,00 € (5 jours)

Voulez-vous que je prépare les relances ?`;

/** A finished turn: a question, one tool step and its result, then a Markdown reply. */
export const transcript: readonly Entry[] = [
  user(1, 'Quelles factures sont en retard cette semaine ?'),
  assistant(2, 1, [{ type: 'toolCall', id: 'c1', name: 'search_invoices', arguments: { status: 'late', week: 45 } }], { stopReason: 'toolUse' }),
  toolResult(3, 1, 'c1', 'search_invoices', '[{"id":"F-2026-041","client":"Maison Orme","total":388},{"id":"F-2026-043","client":"Studio Vallon","total":2910}]'),
  assistant(4, 1, [{ type: 'text', text: lateInvoicesReply }]),
];

export type ChatState = 'loading' | 'empty' | 'populated' | 'streaming' | 'error' | 'offline';

const identity = { runtimeId: 'gallery', scopeId: 'atelier-lumen', principalId: 'camille' };
const agentDoc = { 'pi.agent': { model: { provider: 'fictional', modelId: 'atelier-1' }, thinkingLevel: 'moyen' } };
const views: Record<ChatState, Pick<ChatSnapshot, 'connection' | 'view'>> = {
  loading: { connection: { kind: 'connecting' } as never },
  empty: { connection: { kind: 'connected' } as never, view: { entries: [], docs: agentDoc } as never },
  populated: { connection: { kind: 'connected' } as never, view: { entries: transcript, docs: agentDoc } as never },
  streaming: { connection: { kind: 'connected' } as never, view: { entries: [...transcript, user(5, 'Oui, prépare la relance pour Maison Orme.')],
    docs: { ...agentDoc, 'pi.live': { run: { taskId: 2 }, generation: { message: { role: 'assistant', content: [{ type: 'text', text: 'Voici un brouillon de relance pour **Maison Orme** :\n\n> Bonjour, sauf erreur de notre part, la facture F-2026-041' }] } } } } } as never },
  error: { connection: { kind: 'connected' } as never, view: { entries: [user(1, 'Exporte le chiffre d’affaires du trimestre.'),
    assistant(2, 1, [], { stopReason: 'error', errorMessage: 'Le modèle n’a pas répondu à temps.' })], docs: agentDoc } as never },
  offline: { connection: { kind: 'error', error: new Error('Connexion au serveur perdue') } as never },
};

/** A ChatController over a fixed snapshot. Typing edits the draft; Send appends the message and a short fictional answer. */
export function fakeChat(state: ChatState, options: { readonly draft?: string; readonly conversationId?: string } = {}): ChatController & { readonly set: (state: ChatState) => void } {
  const listeners = new Set<() => void>();
  let next = 100;
  let snapshot: ChatSnapshot = Object.freeze({
    identity, conversationId: options.conversationId ?? 'c-relances', ...views[state],
    draft: { text: options.draft ?? '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false,
  } as ChatSnapshot);
  const publish = (change: Partial<ChatSnapshot>) => { snapshot = Object.freeze({ ...snapshot, ...change }); listeners.forEach(listener => listener()); };
  const entries = () => ((snapshot.view as { entries?: readonly Entry[] } | undefined)?.entries ?? []);
  const done = () => Promise.resolve(undefined);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (state: ChatState) => publish(views[state]),
    setText: (text: string) => publish({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
    setAttachments: () => undefined,
    clearHistory: () => undefined,
    loadEarlier: done,
    connect: done,
    stop: done,
    dispose: () => undefined,
    reconcile: done,
    retrySameRequest: done,
    send(_whenBusy?: unknown, input?: { readonly text?: string }) {
      const text = (input?.text ?? snapshot.draft.text).trim();
      if (!text) return done();
      const task = next++;
      publish({ draft: { text: '', attachments: [], version: snapshot.draft.version + 1 }, view: { entries: [...entries(), user(next++, text)], docs: agentDoc } as never });
      setTimeout(() => publish({ view: { entries: [...entries(), assistant(next++, task, [{ type: 'text', text: 'C’est noté. (Réponse fictive de la galerie.)' }])], docs: agentDoc } as never }), 700);
      return done();
    },
  } as unknown as ChatController & { readonly set: (state: ChatState) => void };
}

export const conversations = [
  { id: 'c-relances', title: 'Factures en retard', updatedAt: '2026-11-04T08:34:00Z', lastMessage: 'Voulez-vous que je prépare les relances ?' },
  { id: 'c-devis', title: 'Devis Boulangerie Ferrand', updatedAt: '2026-11-03T16:10:00Z', lastMessage: 'Le devis D-118 est prêt.' },
  { id: 'c-stock', title: 'Stock d’argile, novembre', updatedAt: '2026-11-01T10:05:00Z', lastMessage: 'Commande passée chez le fournisseur.' },
] as const;

export const suggestions = [
  { label: 'Factures en retard', text: 'Quelles factures sont en retard ?' },
  { label: 'Résumé de la semaine', text: 'Résume les commandes de la semaine 45.' },
] as const;

export const slashCommands = [
  { name: 'relance', description: 'Préparer une relance de paiement', run: () => undefined },
  { name: 'export', description: 'Exporter les commandes en CSV', run: () => undefined },
  { name: 'devis', description: 'Créer un devis', sourcePlugin: 'ventes', run: () => undefined },
] as const;
export const slashSkills = [{ name: 'compta', description: 'Rapprocher les paiements du relevé bancaire' }] as const;

export const workspaceFiles = ['factures/F-2026-041.pdf', 'factures/F-2026-043.pdf', 'clients/maison-orme.json', 'clients/studio-vallon.json', 'commandes/semaine-45.csv'] as const;
export const mentionSearch = async (query: string) => workspaceFiles.filter(path => path.includes(query.toLowerCase())).map(path => ({ path, kind: 'file' as const }));

export const models = [
  { provider: 'fictional', modelId: 'atelier-1', label: 'Atelier 1' },
  { provider: 'fictional', modelId: 'atelier-1-mini', label: 'Atelier 1 mini' },
] as const;

/* ---------- resources ---------- */

export const fileIdentity = { scopeId: 'atelier-lumen', principalId: 'camille', initiatorId: 'camille' };
const encoder = new TextEncoder();
export const locator = (path: string): ResourceLocator => ({ resource: { providerId: 'gallery-memory', path }, view: { kind: 'published' } });

/**
 * An in-memory ResourceClient: reads the files it holds and commits publications atomically, with the receipt a text buffer checks.
 * `refuse` makes every publication a known refusal (the error state of an editor).
 */
export function memoryClient(files: Readonly<Record<string, { readonly text: string; readonly mediaType: string }>>, options: { readonly refuse?: string } = {}): ResourceClient {
  const store = new Map<string, { bytes: Uint8Array; mediaType: string; revision: number }>(Object.entries(files).map(([path, file]) => [path, { bytes: encoder.encode(file.text), mediaType: file.mediaType, revision: 1 }]));
  const ref = (target: ResourceLocator, revision: number): ResourceRef => ({ ...target, revision: `r${revision}` });
  return {
    async read(request: ResourceRead): Promise<ReadResult> {
      const file = store.get(request.target.resource.path);
      return file ? { kind: 'available', snapshot: { ref: ref(request.target, file.revision), bytes: file.bytes, mediaType: file.mediaType } } : { kind: 'missing' };
    },
    async publish(request: PublicationRequest): Promise<PublicationResult> {
      if (options.refuse) return { kind: 'denied', reason: options.refuse };
      const committed = request.changes.map(change => {
        const path = change.target.resource.path, before = store.get(path);
        if (change.kind === 'delete') { store.delete(path); return { kind: 'delete' as const, before: change.target, after: null }; }
        const revision = (before?.revision ?? 0) + 1;
        store.set(path, { bytes: change.bytes, mediaType: change.mediaType, revision });
        const locatorOnly = { resource: change.target.resource, view: change.target.view };
        return change.kind === 'create' ? { kind: 'create' as const, before: null, after: ref(locatorOnly, revision) } : { kind: 'replace' as const, before: change.target, after: ref(locatorOnly, revision) };
      });
      return { kind: 'committed', receipt: { operationId: request.operationId, argumentDigest: await publicationDigest(request), principalId: fileIdentity.principalId, scopeId: fileIdentity.scopeId,
        initiatorId: fileIdentity.initiatorId, changes: committed as never, evidenceRef: `gallery:${request.operationId}` } };
    },
  };
}

/* ---------- task list ---------- */

const tasks = { kind: 'fictional.task-list' as const, version: 1 as const, items: [
  { id: 't1', title: 'Relancer Maison Orme (F-2026-041)', completed: false },
  { id: 't2', title: 'Envoyer le devis D-118 à Boulangerie Ferrand', completed: false },
  { id: 't3', title: 'Commander 40 kg d’argile blanche', completed: true },
  { id: 't4', title: 'Préparer l’export de la semaine 45', completed: false },
] };

export type TaskState = 'populated' | 'empty' | 'readonly' | 'refused';
export function taskController(state: TaskState) {
  const path = 'taches/semaine-45.tasks.json';
  const text = serializeTaskList(tasks);
  const client = memoryClient({ [path]: { text, mediaType: taskListMediaType } }, state === 'refused' ? { refuse: 'Droits insuffisants sur ce dossier' } : {});
  const source = state === 'empty' ? { kind: 'new' as const, target: locator('taches/nouvelle.tasks.json'), text: serializeTaskList(emptyTaskList()) }
    : { kind: 'saved' as const, snapshot: { ref: { ...locator(path), revision: 'r1' }, bytes: encoder.encode(text), mediaType: taskListMediaType } };
  return createTaskListController({ identity: fileIdentity, instanceId: `gallery-${state}`, epoch: 'page', source: source as never, client, readOnly: state === 'readonly' });
}

/* ---------- PM artifacts ---------- */

/** A maquette of a fictional pottery workshop's booking flow, in French. Schema: registry/maquette-viewer (version 1). */
export const maquette = JSON.stringify({
  version: 1, title: 'Atelier Lumen : réserver un cours', device: 'phone', start: 'cours',
  nav: [{ label: 'Cours', goto: 'cours' }, { label: 'Mes réservations', goto: 'confirme' }],
  screens: {
    cours: { title: 'Les cours de la semaine', note: 'Là où arrive un élève : les cours de la semaine et les places restantes.', blocks: [
      { type: 'heading', label: 'Réserver un cours' },
      { type: 'text', label: 'Cours fictifs de tournage et d’émaillage à l’Atelier Lumen.' },
      { type: 'row', children: [{ type: 'select', label: 'Jour', items: ['Tous les jours', 'Mardi', 'Jeudi', 'Samedi'] }, { type: 'input', label: 'Recherche', placeholder: 'Tour, émail…' }] },
      { type: 'table', columns: ['Cours', 'Quand', 'Places'], rows: [['Tournage, débutants', 'Mar. 18:30', '3 restantes'], ['Émaillage', 'Jeu. 19:00', 'Complet'], ['Modelage libre', 'Sam. 10:00', '6 restantes']] },
      { type: 'button', label: 'Tournage, débutants', goto: 'cours-detail', primary: true },
    ] },
    'cours-detail': { title: 'Tournage, débutants', blocks: [
      { type: 'card', label: 'Mardi 18:30 à 20:30', children: [{ type: 'text', label: 'Deux heures au tour avec Inès, l’enseignante fictive. Terre et tablier fournis.' }, { type: 'badge', label: '3 places restantes' }] },
      { type: 'input', label: 'Votre nom', placeholder: 'Camille Exemple' },
      { type: 'input', label: 'E-mail', placeholder: 'camille@example.test' },
      { type: 'row', children: [{ type: 'button', label: 'Retour aux cours', goto: 'cours' }, { type: 'button', label: 'Réserver ma place', goto: 'confirme', primary: true }] },
    ] },
    confirme: { title: 'Réservation confirmée', blocks: [
      { type: 'heading', label: 'C’est réservé' },
      { type: 'document', label: 'Confirmation AL-0417', lines: ['Tournage, débutants', 'Mardi 18:30, salle des tours', '1 place, réglée à l’atelier'] },
      { type: 'list', label: 'Avant de venir', items: ['Des ongles courts aident au tour', 'Apportez une serviette', 'Annulation jusqu’à 24 h avant'] },
      { type: 'link', label: 'Réserver un autre cours', goto: 'cours' },
    ] },
  },
  workflow: { states: [{ id: 'choix', label: 'Choix' }, { id: 'reserve', label: 'Place retenue' }, { id: 'confirme', label: 'Confirmée' }, { id: 'annule', label: 'Annulée' }],
    transitions: [{ from: 'choix', to: 'reserve', label: 'choisit un cours', by: 'élève' }, { from: 'reserve', to: 'confirme', label: 'e-mail de confirmation', by: 'app' }, { from: 'confirme', to: 'annule', label: 'annule 24 h avant', by: 'élève' }] },
  cases: [{ name: 'Première réservation', steps: [{ screen: 'cours', caption: 'Camille, élève fictive, cherche un cours pour débutants.' }, { screen: 'cours-detail', caption: 'Elle choisit le tournage du mardi et réserve une place.' }, { screen: 'confirme', caption: 'Elle reçoit la confirmation.' }], path: ['choix', 'reserve', 'confirme'] }],
});
