'use client';

import { MicIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent } from '@/components/ui/message';
import { useChatText } from './labels';
import { useHoldToRecord } from './use-hold-to-record';
import type { PendingVoice, useVoiceMessage } from './use-voice-message';

export const voiceClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function VoiceMessageButton({ voice, disabled }: { readonly voice: ReturnType<typeof useVoiceMessage>; readonly disabled?: boolean }) {
  const { labels } = useChatText();
  const active = voice.phase === 'starting' || voice.phase === 'recording';
  const blocked = !active && (disabled || voice.phase !== 'idle');
  const hold = useHoldToRecord(voice, Boolean(blocked));
  return <div className="flex items-center gap-2"><Button {...hold} variant="ghost" size="icon" className="touch-none" data-testid="voice-message-record" data-state={voice.phase} disabled={blocked} aria-label={labels.voiceHold} title={labels.voiceHold} aria-pressed={voice.phase === 'recording'}>
    <MicIcon data-icon="inline-start" aria-hidden="true" />
  </Button>{(voice.phase === 'starting' || voice.phase === 'recording') && <span role="status" data-testid="voice-recording">{labels.voiceRecording} {voiceClock(voice.seconds)}</span>}</div>;
}

export function PendingVoiceBubble({ pending }: { readonly pending: PendingVoice | undefined }) {
  const { labels } = useChatText();
  if (!pending) return null;
  const failed = pending.phase === 'transcribe-failed' || pending.phase === 'upload-failed';
  const blocked = pending.phase === 'blocked' || pending.phase === 'unconfirmed';
  return <Message align="end" data-testid="voice-pending" data-state={pending.phase}><MessageContent><Bubble variant="muted" align="end"><BubbleContent>
    <div role={failed ? 'alert' : 'status'} className="flex items-center gap-2">
      {!failed && !blocked && <Spinner aria-hidden="true" />}
      <span>{voiceClock(pending.seconds)}</span>
      <span>{pending.phase === 'upload-failed' ? labels.uploadFailedShort : pending.phase === 'transcribe-failed' ? labels.voiceTranscribeFailed : pending.phase === 'blocked' ? labels.voiceBlocked : pending.phase === 'unconfirmed' ? labels.voiceUnconfirmed : labels.voicePreparing}</span>
    </div>
    {(failed || blocked) && <div className="mt-2 flex flex-wrap gap-2">
      {failed && <Button size="sm" variant="outline" data-testid="voice-retry" onClick={pending.retry}>{labels.retry}</Button>}
      {pending.audioOnly && <Button size="sm" variant="outline" data-testid="voice-audio-only" onClick={pending.audioOnly}>{labels.voiceAudioOnly}</Button>}
      {pending.phase !== 'unconfirmed' && <Button size="sm" variant="ghost" data-testid="voice-discard" onClick={pending.discard}>{labels.voiceDiscard}</Button>}
    </div>}
  </BubbleContent></Bubble></MessageContent></Message>;
}
