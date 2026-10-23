import { useState } from 'react';
import { RowView } from '../../../registry/pi-chat/message.tsx';
import { markdownText } from '../../../registry/pi-chat-markdown/markdown.tsx';
import { MessageQueue } from '../../../registry/pi-chat/queue.tsx';
import { Shimmer } from '../../../registry/pi-chat/shimmer.tsx';
import { formAnswer } from '../../../registry/pi-chat/question-card.tsx';
import { ChatTextProvider } from '../../../registry/pi-chat/labels.ts';
import { chatTextFor } from '../../../registry/pi-chat/locale.ts';

const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' };
const tool = (key, status) => ({ kind: 'tool', key, entry: { key, status, call: { type: 'toolCall', id: key, name: 'read', arguments: { path: 'fictional/picnic.md' } }, result: { role: 'toolResult', toolCallId: key, toolName: 'read', isError: status === 'failed', content: [{ type: 'text', text: status === 'failed' ? 'Fictional file is unavailable.' : 'Bring a blanket and a thermos.' }, image], timestamp: 0 } } });
const prose = '# Picnic notes\n\nA **fictional** plan with `inline code`, [a safe link](https://example.com), and /plan.\n\n> Bring enough water.\n\n- [x] Pack the blanket\n- [ ] Check the weather\n\n| Item | Count |\n| --- | --- |\n| Thermos | 2 |\n\n```text\nFictional packing list\n```';
const ask = (key, args, answer) => ({ kind: 'question', key, questionId: key, live: false, call: { type: 'toolCall', id: key, name: 'ask_user', arguments: args },
  result: answer === undefined ? undefined : { role: 'toolResult', toolCallId: key, toolName: 'ask_user', isError: false, content: [{ type: 'text', text: JSON.stringify({ kind: 'answered', answer }) }], timestamp: 0 } });
const FORM = { question: 'A few details for the fictional picnic', questions: [
  { question: 'Who is coming?', options: ['Just us', 'The whole team'] }, { question: 'Any food to avoid?' }, { question: 'Which park?', options: ['Cedar Park', 'Lakeside'] }] };
const reply = (key, parts, extra = {}) => ({ key, type: 'assistant', parts, text: parts.filter(part => part.kind === 'text').map(part => part.text).join('\n'), streaming: false, ...extra });

/** Real registry renderers with fictional native-shaped records; no model, provider or effect authority. */
export function GroupFiveControls({ surface }) {
  const [event, setEvent] = useState('');
  const text = chatTextFor(new URLSearchParams(location.search).get('lang') === 'fr' ? 'fr' : 'en');
  // The transcript is audited with Markdown replies (the pi-chat-markdown item), as the aggregates install it.
  const context = { renderText: markdownText, answer: async (_, answer) => { setEvent(answer); return { kind: 'answered' }; }, developer: true, onOpenImage: () => setEvent('image opened'), openFile: path => setEvent(path), onCopy: async () => setEvent('copied'),
    pieces: { mentions: true, skills: ['plan'], openMention: path => setEvent(path), preview: async () => image },
    commandMentions: { commands: [{ name: 'plan', behavior: 'insert' }], onActivate: () => setEvent('command activated') } };
  const render = row => <RowView key={row.key} row={row} context={context} />;
  const rows = surface === 'messages' ? [
    { key: 'user', type: 'user', message: { role: 'user', content: [{ type: 'text', text: '/plan Read @notes/picnic.md and @uploads/packing-1234abcd.pdf @uploads/photo-1234abcd.png please.' }, image], timestamp: 0 } },
    reply('prose', [{ kind: 'text', key: 'prose-text', text: prose }]),
  ] : surface === 'activity' ? [
    reply('working', [], { streaming: true, active: true }),
    reply('running', [tool('running-tool', 'running')], { streaming: true, active: true }),
    reply('failed-tool', [tool('failed-tool', 'failed')]),
    reply('reasoning', [{ kind: 'thinking', key: 'reasoning-step', text: 'Prepare the fictional packing list.', streaming: false }, tool('done-tool', 'completed')]),
  ] : surface === 'notices' ? [
    reply('error', [{ kind: 'text', key: 'error-text', text: 'A fictional partial response.' }], { stopReason: 'error', errorMessage: 'Fictional model is unavailable.' }),
    reply('aborted', [], { stopReason: 'aborted' }),
    { key: 'system', type: 'system', text: 'Fictional system context.' },
    { key: 'orphan', type: 'orphan-result', message: tool('orphan', 'failed').entry.result },
  ] : surface === 'questions' ? [
    { key: 'ask-user', type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Can you create the first version of the fictional picnic app?' }], timestamp: 0 } },
    reply('answered-single', [ask('answered-single', { question: 'Pour la première version, sans accès automatique aux plateformes pour l’instant, quel périmètre valides-tu ?',
      options: ['Commencer avec une saisie manuelle', 'Attendre les accès pour inclure la découverte automatique dès la première version'] }, 'Attendre les accès pour inclure la découverte automatique dès la première version'),
      { kind: 'text', key: 'answered-single-text', text: 'Noted: the first version waits for the platform access.' }]),
    reply('answered-form', [ask('answered-form', FORM, formAnswer(FORM.questions, ['The whole team', '', 'Lakeside'], text.labels.skipped))]),
    reply('pending-single', [ask('pending-single', { question: 'Which fictional delivery should we prepare?', options: ['A complete release checklist, with review notes and a summary for the Cedar Works team.', 'The short update.'] })]),
    reply('pending-form', [ask('pending-form', FORM)]),
  ] : [];
  return <ChatTextProvider value={text}><main className="pi-chat mx-auto flex w-full max-w-2xl flex-col gap-6 p-4" data-testid="group-five-controls" data-surface={surface}>
    <section data-testid="transcript" className="flex flex-col gap-6">{rows.map(render)}</section>
    {surface === 'queue' && <>
      <Shimmer>Preparing a fictional reply</Shimmer>
      <MessageQueue items={[{ id: 1, mode: 'followUp', content: 'Pack the fictional picnic basket.' }, { id: 2, mode: 'steer', content: 'Use the shady table instead.' }]}
        sending={[{ text: 'Check the weather too.', attachments: [] }]} withdraw={async () => { throw new Error('Fictional withdrawal refused.'); }}
        actions={{ edit: async item => setEvent(`edited ${item.id}`), steer: async item => setEvent(`steered ${item.id}`) }} />
    </>}
    <output data-testid="group-five-event">{event}</output>
  </main></ChatTextProvider>;
}
