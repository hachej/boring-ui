'use client';

import { MicIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent } from '@/components/ui/message';
import { useChatText } from '../pi-chat/labels';
import { voiceClock } from '../pi-chat/config';
import type { PendingVoiceBubbleProps, VoiceMessageButtonProps } from '../pi-chat/config';
import { useHoldToRecord } from './use-hold-to-record';
import { useVoiceMessage } from './use-voice-message';
import { cn } from '../utils/utils';

export { voiceClock } from '../pi-chat/config';

export function VoiceMessageButton({ voice, disabled, primary = false, tapToFinish = false, testId = 'voice-message-record' }: VoiceMessageButtonProps) {
  const { labels } = useChatText();
  const active = voice.phase === 'starting' || voice.phase === 'recording';
  const blocked = !active && (disabled || voice.phase !== 'idle');
  const hold = useHoldToRecord(voice, Boolean(blocked));
  const tap = tapToFinish && active;
  return <div className="flex min-w-0 items-center gap-2">
    {tap && <Button variant="ghost" size="icon" data-testid="composer-voice-cancel" aria-label={labels.voiceCancel} title={labels.voiceCancel} onClick={voice.cancel} className="min-h-11 min-w-11 shrink-0"><XIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    <Button {...(tap ? { onPointerDown: (event: { preventDefault: () => void }) => event.preventDefault(), onClick: voice.finish } : hold)} variant={primary ? 'default' : 'ghost'} size="icon" className={cn('touch-none shrink-0', tap && 'min-h-11 min-w-11')} data-testid={testId} data-state={voice.phase} disabled={blocked} aria-label={tap ? labels.send : labels.voiceHold} title={tap ? labels.send : labels.voiceHold} aria-pressed={voice.phase === 'recording'}>
      <MicIcon data-icon="inline-start" aria-hidden="true" />
    </Button>{active && <span role="status" data-testid="voice-recording" className="min-w-0">{labels.voiceRecording} {voiceClock(voice.seconds)}</span>}
  </div>;
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

/** Hold-to-record voice messages for the chat: `voiceMessage={{ ...config, ...voiceMessagePlugin }}`. */
export const voiceMessagePlugin = { useRecorder: useVoiceMessage, Button: VoiceMessageButton, Bubble: PendingVoiceBubble } as const;
