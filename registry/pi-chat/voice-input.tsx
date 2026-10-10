// A microphone button for the composer: records on the first click, stops on the second, transcribes the recording and appends the
// text to the composer draft. It never sends: the person reads the transcript and presses Send. Pass it to `PiChat` as `tools`.
import { useEffect, useRef, useState } from 'react';
import { Loader2Icon, MicIcon, SquareIcon, XIcon } from 'lucide-react';
import { createVoiceCapture } from '@hachej/boring-feedback/page';
import type { VoiceCapture, VoiceRefusal } from '@hachej/boring-feedback/page';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { useChatText } from './labels';
import type { ChatLabels } from './labels';
import { cn } from '../utils/utils';

export interface VoiceInputProps {
  /** The chat whose composer draft receives the transcript. */
  readonly controller: NativeChatController;
  /** Turns the recording into text. `signal` aborts when the person cancels or leaves the page; a rejection shows an error. */
  readonly transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
}

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing';

/** The words for each reason the microphone could not be used (the package's own English refusals are not shown). */
const REFUSAL: Readonly<Record<VoiceRefusal, (labels: ChatLabels) => string>> = {
  denied: labels => labels.voiceDenied,
  'no-microphone': labels => labels.voiceNoMicrophone,
  busy: labels => labels.voiceBusy,
  insecure: labels => labels.voiceInsecure,
  unsupported: labels => labels.voiceUnsupported,
  failed: labels => labels.voiceStartFailed,
};

const ROUND = 'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-muted text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none';

export function VoiceInput({ controller, transcribe }: VoiceInputProps) {
  const { labels } = useChatText();
  const [phase, setPhase] = useState<Phase>('idle');
  const [problem, setProblem] = useState<string | undefined>();
  // One capture per mounted button. Each recording gets a run number: a cancel or unmount bumps it, so late results are dropped.
  const capture = useRef<VoiceCapture | null>(null);
  const run = useRef(0);
  const work = useRef<AbortController | null>(null);
  capture.current ??= createVoiceCapture();

  // Leaving the page (or the chat) releases the microphone and abandons any transcription in flight.
  useEffect(() => () => {
    run.current += 1;
    capture.current?.cancel();
    work.current?.abort();
  }, []);

  const append = (spoken: string) => {
    const draft = controller.getSnapshot().draft.text;
    controller.setText(`${draft}${draft === '' || /\s$/.test(draft) ? '' : ' '}${spoken}`);
  };

  const start = async () => {
    const attempt = ++run.current;
    setProblem(undefined);
    setPhase('starting');
    // Called synchronously from the click, so the browser ties the permission prompt to the person's gesture.
    const result = await capture.current!.start();
    if (attempt !== run.current) return;
    if (result.kind === 'refused') {
      setPhase('idle');
      setProblem(result.code ? REFUSAL[result.code](labels) : result.reason);
      return;
    }
    setPhase('recording');
  };

  const finish = async () => {
    const attempt = run.current;
    setPhase('transcribing');
    const recording = await capture.current!.stop().catch(() => null);
    if (attempt !== run.current) return;
    if (!recording) {
      setPhase('idle');
      setProblem(labels.voiceNothingHeard);
      return;
    }
    const abort = new AbortController();
    work.current = abort;
    try {
      const spoken = (await transcribe(recording.audio, abort.signal)).trim();
      if (attempt !== run.current) return;
      if (spoken) append(spoken);
      else setProblem(labels.voiceNothingHeard);
    } catch {
      if (attempt === run.current) setProblem(labels.voiceTranscribeFailed);
    } finally {
      if (work.current === abort) work.current = null;
      if (attempt === run.current) setPhase('idle');
    }
  };

  const cancel = () => {
    run.current += 1;
    capture.current?.cancel();
    work.current?.abort();
    work.current = null;
    setProblem(undefined);
    setPhase('idle');
  };

  const onClick = () => {
    if (phase === 'idle') void start();
    else if (phase === 'recording') void finish();
  };

  const recording = phase === 'recording';
  const busy = phase === 'transcribing';
  return (
    <div className="flex items-center gap-1.5">
      {(recording || busy) && <button type="button" data-testid="composer-voice-cancel" aria-label={labels.voiceCancel} title={labels.voiceCancel} onClick={cancel} className={ROUND}>
        <XIcon className="size-4" aria-hidden="true" /></button>}
      <button type="button" data-testid="composer-voice" data-state={phase} aria-pressed={recording} aria-label={recording ? labels.voiceStop : labels.voiceRecord}
        title={recording ? labels.voiceStop : labels.voiceRecord} disabled={phase === 'starting' || busy} onClick={onClick}
        className={cn(ROUND, recording && 'bg-destructive text-white hover:bg-destructive/90')}>
        {busy ? <Loader2Icon role="status" aria-label={labels.voiceTranscribing} className="size-4 animate-spin motion-reduce:animate-none" />
          : recording ? <SquareIcon className="size-4 fill-current" aria-hidden="true" />
          : <MicIcon className="size-5" aria-hidden="true" />}
      </button>
      {problem && <span role="alert" data-testid="composer-voice-problem" className="max-w-56 text-xs leading-4 text-destructive">{problem}</span>}
    </div>
  );
}
