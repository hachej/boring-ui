// A microphone button for the composer: records on the first click, stops on the second, transcribes the recording and appends the
// text to the composer draft. It never sends: the person reads the transcript and presses Send. Pass it to `PiChat` as `tools`.
import { useDictation } from '@hachej/boring-ui-kit/chat-react';
import { Loader2Icon, MicIcon, SquareIcon, XIcon } from 'lucide-react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { appendToDraft } from '@hachej/boring-ui-kit/chat-text';
import { useChatText } from '../pi-chat/labels';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';

export interface VoiceInputProps {
  /** The chat whose composer draft receives the transcript. */
  readonly controller: NativeChatController;
  /** Turns the recording into text. `signal` aborts when the person cancels or leaves the page; a rejection shows an error. */
  readonly transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
  /** Capture limit (default five minutes); the person still finishes before text is appended. */
  readonly maxMs?: number | undefined;
}

export function VoiceInput({ controller, transcribe, maxMs }: VoiceInputProps) {
  const { labels } = useChatText();
  const { phase, problem, start, finish, cancel } = useDictation({ transcribe, labels, maxMs, target: controller,
    onText: (spoken, signal) => {
      if (!signal.aborted) controller.setText(appendToDraft(controller.getSnapshot().draft.text, spoken));
    },
  });
  const onClick = () => { if (phase === 'idle') start(); else finish(); };
  const recording = phase === 'recording';
  const busy = phase === 'transcribing';
  return (
    <div className="flex items-center gap-1.5">
      {(phase === 'starting' || recording || busy) && <Button variant="ghost" size="icon" data-testid="composer-voice-cancel" aria-label={labels.voiceCancel} title={labels.voiceCancel} onClick={cancel}>
        <XIcon data-icon="inline-start" aria-hidden="true" /></Button>}
      <Toggle data-testid="composer-voice" data-state={phase} pressed={recording} aria-label={phase === 'starting' ? labels.voiceCancel : recording ? labels.voiceStop : labels.voiceRecord}
        title={phase === 'starting' ? labels.voiceCancel : recording ? labels.voiceStop : labels.voiceRecord} disabled={busy} onPressedChange={onClick}>
        {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin motion-reduce:animate-none" role="status" aria-label={labels.voiceTranscribing} />
          : recording ? <SquareIcon data-icon="inline-start" aria-hidden="true" />
          : <MicIcon data-icon="inline-start" aria-hidden="true" />}
      </Toggle>
      {problem && <span role="alert" data-testid="composer-voice-problem" className="max-w-56 text-xs leading-4 text-destructive">{problem}</span>}
    </div>
  );
}
