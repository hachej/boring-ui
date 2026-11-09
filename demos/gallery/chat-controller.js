// A scripted, fictional chat controller for the gallery (the shape test/fixtures/themes/composer-content.jsx uses): no network, no model.
// The first conversation is a short exchange, then a question card, then an approval card; `resolve` answers either and the script goes on.
const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 2 });
const entry = (id, model) => ({ id, kind: 'message', byTaskId: 100, model: [model] });
const say = (id, text) => entry(id, { role: 'user', content: text, timestamp: 1 });
const reply = (id, text) => entry(id, assistant([{ type: 'text', text }]));
const call = (id, callId, name, args) => entry(id, assistant([{ type: 'toolCall', id: callId, name, arguments: args }]));
const result = (id, callId, name, text) => entry(id, { role: 'toolResult', toolCallId: callId, toolName: name, content: [{ type: 'text', text }], isError: false, timestamp: 2 });

const INTRO = [
  '## Le marché de la semaine', '',
  'Voici ce que je propose pour **samedi** :', '',
  '- Légumes de saison pour la soupe',
  '- Farine de sarrasin pour les galettes', '',
  'Le tout tient dans un budget de `40 €`.',
].join('\n');
const LIVE = { run: { taskId: 100 } };
const QUESTION = { question: 'Quel jour fait-on le marché ?', options: ['Samedi', 'Dimanche'] };

/** `scripted: false` gives a plain chat that only answers what it is sent; `true` starts the question-and-approval conversation. */
export function createDemoChat({ id = 'gallery', scripted = true, sent = [] } = {}) {
  let entries = scripted ? [say(1, 'Prépare le marché de la semaine.'), reply(2, INTRO), call(3, 'q', 'ask_user', QUESTION)] : [];
  let docs = scripted ? { 'pi.live': LIVE } : {};
  let snapshot = { identity: { runtimeId: 'fictional', scopeId: id, principalId: 'fictional-reader' }, conversationId: id, connection: { kind: 'connected' },
    view: { entries, docs }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const listeners = new Set();
  const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  const show = (nextEntries, nextDocs = docs) => { entries = nextEntries; docs = nextDocs; change({ view: { entries, docs } }); };
  const next = () => entries.length + 1;
  return {
    getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setText: text => change({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
    setAttachments: attachments => change({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }),
    send: async () => {
      const { text, attachments } = snapshot.draft;
      sent.push(text);
      const label = attachments.length ? `${text} (${attachments.length} pièce jointe${attachments.length > 1 ? 's' : ''})` : text;
      change({ draft: { text: '', attachments: [], version: snapshot.draft.version + 1 } });
      show([...entries, say(next(), label || '(sans texte)'), reply(next() + 1, 'Bien noté. C\'est une réponse fictive : la démo n\'appelle aucun modèle.')], {});
    },
    /** What the fake recorder admits: a voice message, already transcribed. */
    sendVoice: () => show([...entries, say(next(), 'Message vocal : « Ajoute des pommes à la liste. »'), reply(next() + 1, 'Pommes ajoutées à la liste de courses.')], {}),
    /** Answers what waits (the question, then the approval) and goes on with the script. The card's question id is not a call id, so the stage decides. */
    resolve(value) {
      const callId = docs['pi.live']?.tools ? 'g' : docs['pi.live'] ? 'q' : undefined;
      if (callId === 'q') {
        show([...entries, result(next(), 'q', 'ask_user', String(value)), reply(next() + 1, `Va pour ${String(value).toLowerCase()}. Je prépare la liste de courses ; une dernière chose : puis-je supprimer le brouillon de l'an dernier ?`),
          call(next() + 2, 'g', 'supprimer_brouillon', { path: 'carnet/brouillon-2025.md' })], { 'pi.live': { ...LIVE, tools: [{ callId: 'g', details: { 'boring.approval': { summary: 'Supprimer le brouillon de l\'an dernier ?' } } }] } });
      } else if (callId === 'g') {
        const approved = value === 'Approve';
        show([...entries, result(next(), 'g', 'supprimer_brouillon', approved ? 'Supprimé.' : 'Refusé.'), reply(next() + 1, approved ? 'Brouillon supprimé. La semaine est prête.' : 'Le brouillon reste en place. La semaine est prête.')], {});
      }
    },
    connect: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
  };
}
