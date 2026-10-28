'use client';

import type { ReactNode } from 'react';
import { HandIcon, MicIcon, MousePointer2Icon, PauseIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Composer } from '../pi-chat/composer';
import type { ComposerProps } from '../pi-chat/composer';
import type { VoiceMessageHandle } from '../pi-chat/config';
import { voiceClock } from '../pi-chat/config';
import { RecordingBar, VoiceMessageButton } from '../pi-chat-voice/voice-message';
import { InlinePointInput } from './inline-point-input';
import type { PointChip } from './point-state';

/** One composer for a sheet, a conversation column or an ambient bar. The host owns placement, admission and capture. */
export interface PmComposerProps {
  readonly variant?: 'composer' | 'strip';
  readonly composer?: ComposerProps;
  readonly selections?: readonly PointChip[];
  readonly onRemove?: (id: string) => void;
  readonly show: boolean;
  readonly onShow: (show: boolean) => void;
  readonly onReturn?: () => void;
  readonly onOpenRecorder?: () => void;
  readonly focusInput?: boolean;
  readonly voice?: VoiceMessageHandle;
  readonly transcript?: ReactNode;
}
const noSelections: readonly PointChip[] = [];
const silentVoice: VoiceMessageHandle = { canStart: false, phase: 'idle', seconds: 0, captureSequence: 0, pending: [], problem: undefined, start() {}, finish() {}, cancel() {} };

export function PmComposer({ variant = 'composer', composer, selections = noSelections, onRemove, show, onShow, onReturn, onOpenRecorder, focusInput, voice, transcript }: PmComposerProps) {
  const recording = voice?.phase === 'starting' || voice?.phase === 'recording';
  if (variant === 'strip') return <div data-feedback-ignore="" data-pm-strip="" data-testid="pm-strip" data-pointing={show} className="flex h-14 min-h-14 shrink-0 items-center gap-1 bg-foreground px-2 text-background">
    {recording && <ToggleGroup variant="outline" value={[show ? 'select' : 'navigate']} onValueChange={values => { if (values[0]) onShow(values[0] === 'select'); }} role="radiogroup" aria-label="Mode de pointage">
      <ToggleGroupItem value="select" role="radio" aria-checked={show} aria-label="Sélectionner" data-testid="pm-select" className="min-h-11 min-w-11"><MousePointer2Icon data-icon="inline-start" className={show ? 'text-foreground' : 'text-background'} /></ToggleGroupItem>
      <ToggleGroupItem value="navigate" role="radio" aria-checked={!show} aria-label="Naviguer" data-testid="pm-navigate" className="min-h-11 min-w-11"><HandIcon data-icon="inline-start" className={show ? 'text-background' : 'text-foreground'} /></ToggleGroupItem>
    </ToggleGroup>}
    <span className="min-w-0 flex-1 text-xs">{!recording ? 'Touchez ce que vous voulez montrer' : show ? 'Parlez et touchez ce que vous montrez' : 'Sélection en pause'}</span>
    {recording && <Button variant="ghost" size="sm" aria-label="Ouvrir le dictaphone" data-testid="pm-timer" onClick={onOpenRecorder} className="min-h-11"><span className="whitespace-nowrap tabular-nums"><span className="text-destructive">●</span> {voiceClock(voice?.seconds ?? 0)}</span></Button>}
    {recording ? <Button variant="ghost" size="icon" aria-label={voice.paused ? 'Reprendre' : 'Pause'} data-testid="pm-pause" disabled={!voice.pause} onClick={voice.paused ? voice.resume : voice.pause} className="min-h-11 min-w-11">{voice.paused ? <MicIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}</Button>
      : <VoiceMessageButton voice={voice ?? silentVoice} testId="pm-mic" />}
    <Button variant="ghost" size="icon" aria-label="Terminé" data-testid="pm-done" onClick={onReturn} className="min-h-11 min-w-11"><XIcon data-icon="inline-start" /></Button>
  </div>;
  if (!composer) throw new Error('PmComposer needs composer props outside strip mode');
  const toggle = <Button variant="ghost" size="icon" disabled={composer.disabled || composer.sendBlocked} aria-pressed={show} onClick={() => onShow(!show)} data-testid="pm-show" aria-label="Montrer" title="Montrer" className="min-h-11 min-w-11"><MousePointer2Icon data-icon="inline-start" /></Button>;
  const selected = new Set(selections.map(chip => chip.id));
  return <div data-feedback-ignore="" data-testid="pm-composer" className="flex min-w-0 flex-col gap-2 [&_[data-testid=composer-controls]_button]:min-h-11 [&_[data-testid=composer-controls]_button]:min-w-11">
    {transcript}
    <Composer {...composer} attachments={composer.attachments.filter(image => !selected.has(image.id))}
      renderInput={selections.length ? ({ text, onText, onCaret, onSend }) => <InlinePointInput text={text} selections={selections} onText={onText} onCaret={onCaret} onRemove={id => onRemove?.(id)} onSend={onSend} disabled={composer.disabled} focus={focusInput} /> : composer.renderInput}
      placeholderContent={<>Décrivez le problème, ou <MousePointer2Icon className="inline size-4 align-text-bottom" aria-hidden="true" /> pour me le montrer.</>} chips={<>{toggle}{composer.chips}</>}
      recording={recording && voice ? <div className="flex w-full min-w-0 items-center gap-1">{toggle}<RecordingBar voice={voice} testId="pm-voice-send" /></div> : composer.recording}
      barEnd={<>{composer.barEnd}{voice && !recording && <VoiceMessageButton voice={voice} testId="pm-mic" />}</>} />
  </div>;
}
