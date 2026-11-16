import { createScriptedAgent } from './scripted-agent.mjs';

// A chat controller (the native shape the shell reads) over the scripted assistant: what the person sends plays the script's matching turn, its tool steps,
// questions, streamed text and errors; the page's answers and file acknowledgements go back to the script. No model, no network.
export function createDemoController({ script, pace = 1 }) {
  let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'demo', principalId: 'fictional-reader' }, conversationId: 'demo', connection: { kind: 'connected' },
    view: { entries: [], docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const listeners = new Set();
  const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  const scripted = createScriptedAgent({ script, pace, entries: () => snapshot.view.entries, show: (entries, docs) => change({ view: { entries, docs } }) });
  let id = 5000;
  const bumped = () => ({ ...snapshot.draft, version: snapshot.draft.version + 1 });
  const controller = {
    getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setText: text => change({ draft: { ...bumped(), text } }),
    setAttachments: attachments => change({ draft: { ...bumped(), attachments } }),
    send: async (_kind, content) => {
      const text = content?.text ?? snapshot.draft.text;
      scripted.stop();
      change({ stop: 'idle', send: { kind: 'idle' }, draft: { ...bumped(), text: '', attachments: [] },
        view: { entries: [...snapshot.view.entries, { id: ++id, kind: 'message', model: [{ role: 'user', content: text, timestamp: 1 }] }], docs: { 'pi.live': { run: { taskId: 7 } } } } });
      void scripted.say(text);
    },
    stop: async () => { scripted.stop(); change({ stop: 'confirmed' }); },
    connect: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
  };
  // `chatProps.actions`: the answers of the question card, and the pane's acknowledgement of a file the agent opened.
  const actions = { answer: async (_questionId, text) => { if (/^\{"kind":"(opened|refused)"/.test(text)) scripted.presented(); else scripted.answer(text); return { kind: 'answered' }; } };
  return { controller, actions, reset: () => { scripted.stop(); change({ stop: 'idle', send: { kind: 'idle' }, view: { entries: [], docs: {} }, draft: { ...bumped(), text: '', attachments: [] } }); } };
}
