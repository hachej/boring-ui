import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';

// D-1812: the real AppShell with an agent (a fake controller that never sends, fictional data). The layer's api is on window.__layer so the test
// can read its state and open it at a snap; the taps themselves are real input events on the trigger.
const IDLE = Object.freeze({ identity: { runtimeId: 'app', scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' }, conversationId: 'fictional-conversation',
  connection: { kind: 'idle' }, send: { kind: 'idle' }, history: { kind: 'disabled' }, draft: { text: '', attachments: [] }, disposed: false, stop: 'idle', view: undefined });
const controller = new Proxy({ getSnapshot: () => IDLE, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : () => Promise.resolve() });
const Mascot = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const Probe = () => { const api = useAgentLayer(); useLayoutEffect(() => { window.__layer = api; }); return null; };
const Day = () => <div><Probe /><p>Ma journée fictive</p><button type="button">Ajouter un repas</button></div>;
const nav = ['Jour', 'Semaine', 'Mois'].map(label => ({ id: label, label, icon: Mascot, render: () => <Day /> }));

createRoot(document.getElementById('root')).render(
  <AppShell layout="screen" title="Forme" nav={nav} route={{ id: 'Jour', onChange() {} }} locale="fr" agent={{ controller, icon: Mascot, label: 'Ton coach' }} />);
