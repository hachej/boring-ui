import { useState } from 'react';
import { EmptyState } from '../../../registry/pi-chat/empty-state';
import { QuestionCard } from '../../../registry/pi-chat/question-card';
import { AgentNotifications, createNotificationStore } from '../../../registry/pi-ambient/notifications';
import { ProviderSetup } from '../../../registry/provider-setup/provider-setup';
import { ActionButton } from '../../../registry/button/actions';
import { AccountMenu } from '../../../registry/app-shell/account';
import { AgentLayerProvider } from '../../../registry/app-shell/agent-layer';
import { appShellText } from '../../../registry/app-shell/text';

// Real registry renderers with fictional host callbacks. No replacement controls,
// model requests, credentials, CSS overrides or alternate conversation state.
export function GroupOneControls({ surface }) {
  const [event, setEvent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [dark, setDark] = useState(false);
  const [notifications] = useState(() => {
    const store = createNotificationStore();
    store.push({ kind: 'done', title: 'Fictional Cedar Works document', summary: 'The draft is ready for you to review.', conversationId: 'fictional-preview' });
    return store;
  });
  return <main className="pi-chat mx-auto grid w-full max-w-2xl gap-6 p-4" data-testid="group-one-controls" data-surface={surface}>
    {surface === 'choices' && <>
      <EmptyState title="Fictional Cedar Works" description="Choose a fictional draft." suggestions={[
        { label: 'Plan the next release', hint: 'Keep the fictional review notes with this draft.', text: 'plan' },
        { label: 'Write a short update', hint: 'No messages are sent.', text: 'update' },
      ]} onSelect={setEvent} />
      <QuestionCard call={{ type: 'toolCall', id: 'fictional-choice', name: 'ask_user', arguments: { question: 'Which fictional delivery should we prepare?', options: ['Prepare a complete fictional release checklist, with review notes and a summary for the Cedar Works team.', 'Prepare the short update.'] } }} questionId="fictional-choice" answer={async (_, answer) => { setEvent(answer); return { kind: 'answered' }; }} />
    </>}
    {surface === 'notification' && <AgentNotifications store={notifications} variant="surface" placement="inline" autoDismissMs={0} onActivate={() => setEvent('notification opened')} className="static w-full" />}
    {surface === 'provider' && <ProviderSetup defaultOpen providers={[{ id: 'fictional', name: 'Fictional provider', models: [{ id: 'fictional-model', name: 'Fictional model' }], auth: ['api_key'], configured: true }]} value={{ provider: 'fictional', modelId: 'fictional-model' }} onSave={async () => { setEvent('provider saved'); }} />}
    {surface === 'toggles' && <>
      <ActionButton action={{ id: 'pin', label: 'Pin fictional document', pressed: pinned, onSelect: () => setPinned(value => !value) }} testId="fixture" />
      <div className="app-shell"><AgentLayerProvider><AccountMenu account={{ name: 'Fictional reviewer', menu: [], theme: { value: dark ? 'dark' : 'light', onChange: value => { setDark(value === 'dark'); setEvent(count => String(Number(count || 0) + 1)); } } }} improve={false} text={appShellText('en')} done={() => {}} /></AgentLayerProvider></div>
    </>}
    <output data-testid="group-one-event">{event}</output>
  </main>;
}
