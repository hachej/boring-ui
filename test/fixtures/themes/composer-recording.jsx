import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Composer } from '../../../registry/pi-chat/composer.tsx';
import { RecordingBar, RecordingStatus, RecordingStop, VoiceMessageButton } from '../../../registry/pi-chat-voice/voice-message.tsx';

// D-1759: the real composer with the real voice-message parts, in the three phases a person sees: idle, starting, recording. The page is driven by
// the query string (?layout=card|pill&state=idle|starting|recording&theme=light|dark). Two cases: the microphone standing in for Send
// (`voiceReplacesSend`), and the microphone beside a disabled Send. Fictional text only.
const noop = () => {};
const query = new URLSearchParams(location.search);
const layout = query.get('layout') ?? 'card', state = query.get('state') ?? 'idle';
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const levels = [0.1, 0.3, 0.5, 0.2, 0.7, 0.4, 0.6, 0.3, 0.2, 0.5, 0.8, 0.4, 0.3, 0.6, 0.2, 0.1];
const voice = { phase: state, canStart: true, seconds: 7, levels: state === 'recording' ? levels : [], paused: false, start: noop, cancel: noop, finish: noop, pause: noop, resume: noop, problem: undefined, pending: [], captureSequence: 0 };

function Case({ id, replaces, hint, legacy }) {
  const ref = useRef(null);
  const props = { attachments: [], onRemoveAttachment: noop, working: false, sendBlocked: false, disabled: false, stopRequested: false, onSend: noop, onStop: noop, uploading: false, canAttach: true, fileAccept: '', onPickFiles: noop, textareaRef: ref, text: '', onText: noop, layout, ...(hint ? { placeholderContent: <span>Ask about a fictional picnic</span> } : {}) };
  const mic = <VoiceMessageButton voice={voice} primary={replaces} />;
  const capturing = state !== 'idle';
  return <div data-case={id} className="pi-chat mx-auto w-full max-w-[720px]">
    <Composer {...props} {...(replaces ? { whenEmpty: mic } : { barEnd: mic })}
      {...(capturing ? legacy ? { recording: <RecordingBar voice={voice} /> } : { recordingStatus: <RecordingStatus voice={voice} />, recordingStop: <RecordingStop voice={voice} /> } : {})} />
  </div>;
}

// ?only=legacy: the app's own `recording` node (Studio's TalkButton path), no slots. &host=row: the agent layer at peek forces every composer group to a row (agent-layer.tsx), the case that squeezed the bar.
createRoot(document.getElementById('root')).render(query.get('only') === 'legacy' ? <main className="flex flex-col gap-6 p-4"><div className={query.get("host") === "row" ? "[&_[data-slot=input-group]]:flex-row! [&_[data-slot=input-group]]:items-center" : undefined}><Case id="legacy" replaces={false} legacy /></div></main> : <main className="flex flex-col gap-6 p-4">
  <Case id="replace" replaces />
  <Case id="beside" replaces={false} />
  {layout === 'card' && <Case id="hint" replaces hint />}
</main>);
