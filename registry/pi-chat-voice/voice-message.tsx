'use client';

import { CircleIcon, MicIcon, PauseIcon, PlayIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent } from '@/components/ui/message';
import { useChatText } from '../pi-chat/labels';
import { voiceClock } from '../pi-chat/config';
import type { PendingVoiceBubbleProps, VoiceMessageButtonProps } from '../pi-chat/config';
import { useVoiceMessage } from './use-voice-message';

export { voiceClock } from '../pi-chat/config';

/** The same recording row for native chat and a shell-owned capture. It replaces the editable composer controls. */
export function RecordingBar({ voice, testId = 'voice-message-record' }: Pick<VoiceMessageButtonProps, 'voice' | 'testId'>) {
  const { labels, icons } = useChatText();
  return <div data-testid="voice-recording-bar" data-state={voice.paused ? 'paused' : voice.phase} className="flex w-full min-w-0 items-center gap-2">
    <Button variant="ghost" size="icon" data-testid="composer-voice-cancel" aria-label={labels.voiceCancel} title={labels.voiceCancel} onClick={voice.cancel} className="min-h-11 min-w-11 shrink-0"><Trash2Icon aria-hidden="true" /></Button>
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <CircleIcon className="size-3 shrink-0 fill-current text-destructive" aria-hidden="true" />
      <span role="status" aria-live="polite" aria-atomic="true" data-testid="voice-recording" className="shrink-0 tabular-nums"><span className="sr-only">{voice.paused ? labels.voicePaused : labels.voiceRecording} </span>{voiceClock(voice.seconds)}</span>
      {!!voice.levels?.length && <div data-testid="voice-waveform" aria-hidden="true" className="flex h-8 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden">
        {voice.levels.map((level, index) => <span key={index} data-level={level} className="w-1 shrink-0 bg-muted-foreground" style={{ height: `${Math.max(5, Math.sqrt(Math.min(1, level)) * 100)}%` }} />)}
      </div>}
    </div>
    {voice.pause && voice.resume && <Button variant="ghost" size="icon" data-testid="voice-pause" aria-label={voice.paused ? labels.voiceResumeRecording : labels.voicePauseRecording} title={voice.paused ? labels.voiceResumeRecording : labels.voicePauseRecording} onClick={voice.paused ? voice.resume : voice.pause} className="min-h-11 min-w-11 shrink-0">{voice.paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}</Button>}
    <Button variant="default" size="icon" data-testid={testId} data-state={voice.phase} aria-label={labels.send} title={labels.send} onClick={voice.finish} disabled={voice.phase === 'starting'} className="min-h-11 min-w-11 shrink-0"><icons.send aria-hidden="true" /></Button>
  </div>;
}

export function VoiceMessageButton({ voice, disabled, primary = false, testId = 'voice-message-record' }: VoiceMessageButtonProps) {
  const { labels } = useChatText();
  if (voice.phase === 'starting' || voice.phase === 'recording') return <RecordingBar voice={voice} testId={testId} />;
  return <Button onClick={voice.start} variant={primary ? 'default' : 'ghost'} size="icon" className="min-h-11 min-w-11 shrink-0" data-testid={testId} data-state={voice.phase} disabled={disabled || !voice.canStart || voice.phase !== 'idle'} aria-label={labels.voiceRecord} title={labels.voiceRecord}><MicIcon aria-hidden="true" /></Button>;
}

export function PendingVoiceBubble({ pending }: PendingVoiceBubbleProps) {
  const { labels } = useChatText();
  if (!pending) return null;
  const failed = pending.phase === 'transcribe-failed' || pending.phase === 'upload-failed';
  const blocked = pending.phase === 'blocked' || pending.phase === 'unconfirmed';
  return <Message align="end" data-testid="voice-pending" data-voice-id={pending.id} data-state={pending.phase}><MessageContent><Bubble variant="muted" align="end" className={failed || blocked ? 'w-full max-w-full' : undefined}><BubbleContent>
    <div role={failed ? 'alert' : 'status'} className="flex items-center gap-2">
      {!failed && !blocked && <Spinner aria-hidden="true" />}
      {Number.isFinite(pending.seconds) && pending.seconds > 0 && <span data-testid="voice-pending-duration">{voiceClock(pending.seconds)}</span>}
      <span>{pending.phase === 'upload-failed' ? labels.uploadFailedShort : pending.phase === 'transcribe-failed' ? labels.voiceTranscribeFailed : pending.phase === 'blocked' ? labels.voiceBlocked : pending.phase === 'unconfirmed' ? labels.voiceUnconfirmed : labels.voicePreparing}</span>
    </div>
    {(failed || blocked) && <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
      {failed && <Button size="sm" className="h-auto min-h-11 min-w-0 whitespace-normal" variant="outline" data-testid="voice-retry" onClick={pending.retry}>{labels.retry}</Button>}
      {pending.audioOnly && <Button size="sm" className="h-auto min-h-11 min-w-0 whitespace-normal" variant="outline" data-testid="voice-audio-only" onClick={pending.audioOnly}>{labels.voiceAudioOnly}</Button>}
      {pending.phase !== 'unconfirmed' && <Button size="sm" className="h-auto min-h-11 min-w-0 whitespace-normal" variant="ghost" data-testid="voice-discard" onClick={pending.discard}>{labels.voiceDiscard}</Button>}
    </div>}
  </BubbleContent></Bubble></MessageContent></Message>;
}

/** Tap-to-record voice messages for the chat: `voiceMessage={{ ...config, ...voiceMessagePlugin }}`. */
export const voiceMessagePlugin = { useRecorder: useVoiceMessage, Button: VoiceMessageButton, Bubble: PendingVoiceBubble } as const;
