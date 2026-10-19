import { createFakeChannelSource } from '@hachej/boring-ui-kit/shared-chat';
import { sharedChatSeed } from './seed.mjs';

/** Fictional host script, not kit policy or an agent runtime. The real platform forwards to each agent's own Pi conversation. */
export function createPdfDemo({ manual = false } = {}) {
  const source = createFakeChannelSource({ ...sharedChatSeed, conversations: sharedChatSeed.conversations.map(conversation => conversation.id === 'admin' ? { ...conversation, members: [...conversation.members, 'worker'] } : conversation), messages: [
    { id: 'via-person', conversationId: 'main', author: 'leo', at: '2026-10-19T10:00:00Z', via: 'Claude', text: 'Je propose de dater les exports PDF.' },
    { id: 'admin-trace', conversationId: 'admin', author: 'worker', at: '2026-10-19T10:00:00Z', text: 'Vérification de l’export PDF terminée.', streaming: false, steps: [
      { label: 'Lire les fichiers', detail: 'read src/fictional-export.ts', status: 'done' },
      { label: 'Préparer le PDF', detail: 'write output/fictional-export.pdf', status: 'done' },
      { label: 'Vérifier le document', detail: 'check output/fictional-export.pdf', status: 'done' },
    ] },
  ] });
  let plan, card, worker, planned = false, built = false;
  const timers = new Set();
  const at = offset => new Date(Date.now() + offset).toISOString();
  const post = message => source.emit({ type: 'message', message });
  const steps = [
    { label: 'Lire les fichiers', status: 'done' },
    { label: 'Préparer le PDF', status: 'done' },
    { label: 'Vérifier le document', status: 'running' },
  ];
  function planReady() {
    if (!plan || planned) return; planned = true;
    const text = '  \nJe vérifierai le document avant de proposer une version.';
    plan = { ...plan, text: plan.text + text };
    source.emit({ type: 'delta', messageId: plan.id, conversationId: plan.conversationId, text });
  }
  function build() {
    if (!plan || built) return; built = true; planReady();
    steps.forEach((step, index) => source.emit({ type: 'step', messageId: plan.id, conversationId: plan.conversationId, index, step }));
    worker = { id: 'pdf-worker', conversationId: plan.conversationId, author: 'worker', at: at(1), text: 'Je vérifie la mise en page.', streaming: true, steps: [{ label: 'Relire le document', status: 'running' }] };
    post(worker);
    post({ id: 'pdf-doing', conversationId: plan.conversationId, author: 'pm', at: at(2), text: 'Je regarde vos fichiers.' });
    card = { id: 'pdf-card', conversationId: plan.conversationId, author: 'pm', at: at(3), card: { requestId: 'export-pdf', title: 'Export PDF', line: 'Je prépare l’export PDF.', since: at(0), state: 'building', action: { id: 'progress', label: 'Voir la demande' } } };
    post(card);
  }
  function finish() {
    if (!plan) return; build();
    plan = { ...plan, streaming: false, steps: steps.map(step => ({ ...step, status: 'done' })) }; post(plan);
    worker = { ...worker, streaming: false, steps: [{ label: 'Document relu', status: 'done' }] }; post(worker);
    card = { ...card, card: { ...card.card, state: 'preview', line: 'On attend votre essai', action: { id: 'try', label: 'Essayer cette version' } } }; post(card);
  }
  return {
    ...source, planReady, build, finish,
    send: async input => {
      const message = await source.send(input);
      if (input.mentions.includes('pm') && !input.replyTo) {
        for (const timer of timers) clearTimeout(timer); timers.clear(); planned = false; built = false;
        plan = { id: 'pdf-plan', conversationId: input.conversationId, author: 'pm', at: at(0), text: 'Je vais ajouter un export PDF.', streaming: true, steps: [{ label: 'Lire les fichiers', status: 'running' }] };
        post(plan);
        if (!manual) for (const [delay, advance] of [[250, planReady], [1200, build], [6500, finish]]) timers.add(setTimeout(advance, delay));
      }
      if (input.replyTo === 'pdf-card') post({ id: 'pdf-follow-up', conversationId: input.conversationId, author: 'pm', at: at(5), text: 'Je reprends la même demande avec votre précision.', replyTo: 'pdf-card' });
      return message;
    },
  };
}
