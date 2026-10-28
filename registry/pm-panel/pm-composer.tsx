'use client';

import type { CSSProperties, ReactNode } from 'react';
import { HandIcon, MicIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Composer } from '../pi-chat/composer';
import type { ComposerProps } from '../pi-chat/composer';
import type { VoiceMessageHandle } from '../pi-chat/config';
import { RecordingBar } from '../pi-chat-voice/voice-message';
import { cn } from '../utils/utils';
import { InlinePointInput } from './inline-point-input';
import type { PointChip } from './point-state';
import { clock, pmTextFr } from './pm-text';
import type { PmText } from './pm-text';

/** `touch`: the app's sheet and strip (C2–C7). `desktop`: Studio's conversation column (D1, D7–D9). Same behaviour and strings. */
export type PmPreset = 'touch' | 'desktop';

/** One composer for a sheet, a conversation column or an ambient bar. The host owns placement, admission and capture. */
export interface PmComposerProps {
  readonly variant?: 'composer' | 'strip';
  readonly preset?: PmPreset;
  readonly text?: PmText;
  readonly composer?: ComposerProps;
  readonly selections?: readonly PointChip[];
  readonly onRemove?: (id: string) => void;
  /** Strip only: `true` a tap selects (`select`), `false` it goes through to the app (`navigate`). */
  readonly show: boolean;
  readonly onShow: (show: boolean) => void;
  /** Compose only: « Montrer » enters the strip without recording. */
  readonly onPoint?: () => void;
  readonly onReturn?: () => void;
  readonly onOpenRecorder?: () => void;
  readonly focusInput?: boolean;
  readonly voice?: VoiceMessageHandle;
  readonly transcript?: ReactNode;
  /** « Dicté · 0:14 · 2 captures · modifiable » under the draft; absent when there is nothing to say. */
  readonly meta?: string | undefined;
  /** Strip only: « Envoyé au PM » in place of the idle hint for a moment after a comment went straight to the PM (spec 1 §3b). */
  readonly notice?: string | undefined;
}
const noSelections: readonly PointChip[] = [];

/** The kit pointer arrow (spec README rule 5), drawn as lucide draws its icons. */
export function PointerIcon({ className, style }: { readonly className?: string; readonly style?: CSSProperties }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}><path d="M3 3l7 17 2.5-7.5L20 10z" /></svg>;
}

/** The boards' pause: two stroked bars (C4 stroke 2.5, D7b stroke 2), not lucide's filled rectangles. */
function StrokePause({ className, strokeWidth }: { readonly className?: string; readonly strokeWidth: number }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" aria-hidden="true" data-icon="pause" className={className}><path d="M9 5v14" /><path d="M15 5v14" /></svg>;
}

// Shapes are theme tokens: `--radius` drives the host shadcn controls' own radius inside a scope.
const round = { '--radius': 'var(--pm-radius-round)' } as CSSProperties;
const segment = { '--radius': 'var(--pm-radius-segment)' } as CSSProperties;
/** Inside the dark strip the host controls read the inverted roles: outline circles on `primary`, a light « Terminé ». */
const stripScope = { '--background': 'var(--primary)', '--foreground': 'var(--primary-foreground)', '--border': 'var(--pm-strip-line)', '--secondary': 'var(--primary-foreground)', '--secondary-foreground': 'var(--primary)', '--muted': 'var(--primary-foreground)' } as CSSProperties;
const micScope = { ...round, '--primary': 'var(--pm-mic)', '--primary-foreground': 'var(--pm-mic-foreground)' } as CSSProperties;

export function PmComposer(props: PmComposerProps) {
  return props.variant === 'strip' ? <Strip {...props} /> : <Compose {...props} />;
}

function Strip({ preset = 'touch', text = pmTextFr, show, onShow, onReturn, onOpenRecorder, voice, notice }: PmComposerProps) {
  const touch = preset === 'touch';
  const recording = voice?.phase === 'starting' || voice?.phase === 'recording';
  const paused = recording && Boolean(voice?.paused);
  const phase = !recording ? 'idle' : paused ? 'paused' : 'rec';
  const circle = touch ? 'min-h-11 min-w-11' : 'min-h-[34px] min-w-[34px]';
  const icon = touch ? 'size-[18px]' : 'size-[15px]';
  const mic = <Button variant={touch ? 'outline' : 'default'} size="icon" data-testid="pm-mic" aria-label={text.speak} title={text.speak} disabled={!voice || (!recording && !voice.canStart)}
    onClick={() => { if (!voice) return; if (paused) voice.resume?.(); else voice.start(); }} className={cn('shrink-0', circle)} style={touch ? round : micScope}>
    <MicIcon className={icon} aria-hidden="true" /></Button>;
  return <div data-feedback-ignore="" data-pm-strip="" data-testid="pm-strip" data-preset={preset} data-phase={phase} data-pointing={show}
    className={cn('flex shrink-0 items-center gap-2 bg-primary text-primary-foreground', touch ? 'h-15 pr-2 pl-3.5' : 'rounded-pm-box px-3 py-2.5')}
    style={touch ? stripScope : { ...stripScope, '--border': 'var(--primary-foreground)' } as CSSProperties}>
    {recording && <div data-dense="" className="flex shrink-0 rounded-pm-toggle p-0.5 ring-1 ring-inset ring-pm-strip-line [&_[data-pressed]]:text-primary">
      <ToggleGroup value={[show ? 'select' : 'navigate']} onValueChange={values => { if (values[0]) onShow(values[0] === 'select'); }} role="radiogroup" aria-label={text.mode} spacing={0.5}>
        <ToggleGroupItem value="select" role="radio" aria-checked={show} aria-label={text.select} title={text.select} data-testid="pm-select" style={segment}
          className={touch ? 'min-h-[38px] min-w-[38px]' : 'min-h-7 min-w-8'}><PointerIcon className={touch ? 'size-4' : 'size-3.5'} /></ToggleGroupItem>
        <ToggleGroupItem value="navigate" role="radio" aria-checked={!show} aria-label={text.navigate} title={text.navigate} data-testid="pm-navigate" style={segment}
          className={touch ? 'min-h-[38px] min-w-[38px]' : 'min-h-7 min-w-8'}><HandIcon className={touch ? 'size-4' : 'size-3.5'} aria-hidden="true" /></ToggleGroupItem>
      </ToggleGroup>
    </div>}
    {!recording ? <span data-testid="pm-hint" className={cn('min-w-0 flex-1 text-left', touch ? 'text-[14px] leading-[1.3] text-primary-foreground/90' : 'text-xs text-primary-foreground/80')} data-notice={notice ? '' : undefined} role={notice ? 'status' : undefined}>{notice ?? text.hintIdle}</span>
      // C4: hint, dot and time share one right-aligned group (gap 6), so the hint keeps its two full lines at 390px.
      : <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {show && <span data-testid="pm-hint" className={cn('min-w-0 text-right text-xs', touch ? 'leading-[1.25] text-primary-foreground/85' : 'text-primary-foreground/80')}>{text.hintRec}</span>}
        {/* The host button's transparent 1px border is taken back by the margins: the visible gap to the hint stays 5–6px and the C4 hint keeps two lines. */}
        <span className={touch ? 'flex shrink-0 -mr-px -ml-0.5 [&_button]:px-0' : 'flex shrink-0 [&_button]:px-2.5'}><Button variant={touch ? 'ghost' : 'outline'} size={touch ? 'default' : 'sm'} data-testid="pm-timer" aria-label={text.recorder} title={text.recorder} onClick={onOpenRecorder}
          className={cn('shrink-0 gap-1.5 tabular-nums', touch ? 'min-h-11' : 'min-h-[26px]')} style={touch ? undefined : round}>
          <span aria-hidden="true" className={cn('shrink-0 rounded-pm-round', paused ? 'bg-primary-foreground/50' : 'bg-destructive', touch ? 'size-2.5' : 'size-2')} />
          <span className={cn('font-normal', touch ? 'text-[14px]' : 'text-[13px]')}>{clock(voice?.seconds ?? 0)}</span></Button></span>
      </span>}
    {recording && !paused ? <Button variant="outline" size="icon" data-testid="pm-pause" aria-label={text.pause} title={text.pause} disabled={!voice?.pause} onClick={voice?.pause}
      className={cn('shrink-0', circle)} style={round}><StrokePause className={touch ? 'size-[18px]' : 'size-3.5'} strokeWidth={touch ? 2.5 : 2} /></Button> : mic}
    <Button variant="secondary" size="icon" data-testid="pm-done" aria-label={text.done} title={text.done} onClick={onReturn} className={cn('shrink-0', circle)} style={round}>
      <XIcon className={icon} strokeWidth={touch ? 2.5 : 2} aria-hidden="true" /></Button>
  </div>;
}

function Compose({ preset = 'touch', text = pmTextFr, composer, selections = noSelections, onRemove, show, onPoint, onShow, focusInput, voice, transcript, meta }: PmComposerProps) {
  if (!composer) throw new Error('PmComposer needs composer props outside strip mode');
  const touch = preset === 'touch';
  const recording = voice?.phase === 'starting' || voice?.phase === 'recording';
  const point = () => { if (onPoint) onPoint(); else onShow(!show); };
  const montrer = <Button variant="ghost" size="icon" disabled={composer.disabled || composer.sendBlocked} aria-pressed={false} onClick={point} data-testid="pm-show" aria-label={text.show} title={text.showTitle}
    className={touch ? 'min-h-10 min-w-10' : 'min-h-[34px] min-w-[34px]'}><PointerIcon className={touch ? 'size-4' : 'size-[15px]'} /></Button>;
  const mic = voice && !recording && <Button variant={touch ? 'ghost' : 'default'} size="icon" data-testid="pm-mic" aria-label={text.dictate} title={text.dictate} onClick={voice.start}
    disabled={composer.disabled || !voice.canStart || voice.phase !== 'idle'} className={touch ? 'min-h-10 min-w-10' : 'min-h-9 min-w-9'} style={touch ? undefined : micScope}>
    <MicIcon className={touch ? 'size-[18px]' : 'size-[15px]'} aria-hidden="true" /></Button>;
  const selected = new Set(selections.map(chip => chip.id));
  const placeholder = <>{text.placeholderBefore}<PointerIcon className={cn('inline text-muted-foreground', touch ? 'size-4' : 'size-3.5')} style={{ verticalAlign: '-3px' }} />{text.placeholderAfter}</>;
  const filled = Boolean(composer.text.trim()) || selections.length > 0;
  return <div data-feedback-ignore="" data-testid="pm-composer" data-preset={preset} data-filled={filled || undefined}
    className={cn('flex min-w-0 flex-col gap-2',
      // The box: the host InputGroup with the panel's radius; its controls keep the control radius.
      '[--radius:var(--pm-radius-box)] [&_[data-testid=composer-controls]]:[--radius:var(--pm-radius-control)] [&_[data-slot=input-group]]:!bg-background [&_[data-slot=input-group]]:!opacity-100 [&_[data-slot=composer-field]]:min-h-0',
      // The host addon mutes its text; the composer's controls are full ink (C2).
      '[&_[data-testid=composer-controls]]:text-foreground',
      '[&_[data-testid=composer-submit]]:text-primary-foreground [&_[data-testid=composer-submit]:disabled]:bg-pm-send-idle [&_[data-testid=composer-submit]:disabled]:opacity-100',
      '[&_[data-slot=input-group-control]]:placeholder:text-pm-hint [&_[data-slot=composer-placeholder]]:text-pm-hint',
      // D9: the highlighted task row takes the full muted fill.
      '[&_[data-testid=mention-item][aria-selected=true]]:bg-muted',
      // D9: the typed `@d-2` as an inline token (padding 1 6 without moving the text: the margin takes it back).
      '[&_[data-slot=composer-mention-query]]:rounded-pm-token [&_[data-slot=composer-mention-query]]:bg-muted [&_[data-slot=composer-mention-query]]:-mx-1.5 [&_[data-slot=composer-mention-query]]:px-1.5 [&_[data-slot=composer-mention-query]]:py-px',
      touch ? '[&_[data-testid=composer-controls]]:gap-2 [&_[data-testid=composer-controls]_button]:min-h-10 [&_[data-testid=composer-controls]_button]:min-w-10 [&_[data-testid=composer-input]]:text-[15px] [&_[data-slot=composer-placeholder]]:text-[15px]'
        : '[&_[data-testid=composer-controls]]:gap-2 [&_[data-testid=composer-input]]:text-sm [&_[data-slot=composer-placeholder]]:text-sm [&_[data-testid=composer-submit]]:min-h-9 [&_[data-testid=composer-submit]]:min-w-9 [&_[data-testid=composer-plus]]:min-h-[34px] [&_[data-testid=composer-plus]]:min-w-[34px] [&_[data-testid=composer-plus]]:[--radius:var(--pm-radius-round)] [&_[data-testid=composer-plus]]:ring-1 [&_[data-testid=composer-plus]]:ring-inset [&_[data-testid=composer-plus]]:ring-border',
      // D8/D9: focused or filled, the box outline turns primary, without the host focus ring.
      !touch && 'data-[filled]:[&_[data-slot=input-group]]:border-primary [&_[data-slot=input-group]]:has-[:focus-visible]:border-primary [&_[data-slot=input-group]]:!ring-0')}>
    {transcript}
    <Composer {...composer} attachments={composer.attachments.filter(image => !selected.has(image.id))}
      placeholderContent={placeholder}
      renderInput={selections.length || meta ? ({ text: value, onText, onCaret, onSend }) => <InlinePointInput text={value} preset={preset} labels={text} selections={selections} onText={onText} onCaret={onCaret}
        onRemove={id => onRemove?.(id)} onSend={onSend} disabled={composer.disabled} focus={focusInput} placeholder={placeholder} meta={meta} /> : composer.renderInput}
      markMentionQuery chips={<>{montrer}{composer.chips}</>}
      recording={recording && voice ? <div className="flex w-full min-w-0 items-center gap-1">{montrer}<RecordingBar voice={voice} testId="pm-voice-send" /></div> : composer.recording}
      barEnd={<>{composer.barEnd}{mic}</>} />
  </div>;
}

