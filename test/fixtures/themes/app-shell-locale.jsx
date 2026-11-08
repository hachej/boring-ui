import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../../registry/app-shell/app-shell.tsx';
import { useAgentLayer } from '../../../registry/app-shell/agent-layer.tsx';

// D-1900: a youtubevisual-like AppShell (an English or French app: `?locale=`), the real shell with an agent (a fake controller that never sends,
// fictional data) and an account. The layer's api is on window.__layer so the test can open the empty chat.
const IDLE = Object.freeze({ identity: { runtimeId: 'app', scopeId: 'fictional-team', principalId: 'fictional-person', initiatorId: 'fictional-person' }, conversationId: 'fictional-conversation',
  connection: { kind: 'idle' }, send: { kind: 'idle' }, history: { kind: 'disabled' }, draft: { text: '', attachments: [] }, disposed: false, stop: 'idle', view: undefined });
const controller = new Proxy({ getSnapshot: () => IDLE, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : () => Promise.resolve() });
const Icon = ({ className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" /></svg>;
const Probe = () => { const api = useAgentLayer(); useLayoutEffect(() => { window.__layer = api; }); return null; };
const nav = ['Videos', 'Channels', 'Settings'].map(label => ({ id: label, label, icon: Icon, render: () => <div><Probe /><p>Fictional channel overview</p></div> }));
const locale = new URLSearchParams(location.search).get('locale') === 'fr' ? 'fr' : 'en';

createRoot(document.getElementById('root')).render(
  <AppShell layout="screen" title="Visual" nav={nav} route={{ id: 'Videos', onChange() {} }} locale={locale} agent={{ controller, icon: Icon }} account={{ name: 'Camille Martin', menu: [], signOut() {} }} />);
