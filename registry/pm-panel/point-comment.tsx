'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpIcon, Loader2Icon, MicIcon, SquareIcon } from 'lucide-react';
import { useDictation } from '@hachej/boring-ui-kit/chat-react/voice';
import { appendToDraft } from '@hachej/boring-ui-kit/chat-text';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useChatText } from '../pi-chat/labels';
import type { PmComment } from './use-pm-panel';
import type { PmText } from './pm-text';

const WIDTH = 320, GAP = 8;
const sendScope = { '--radius': 'var(--pm-radius-send)' } as CSSProperties;

/** Below the pick and left-aligned with it; above when there is no room below; always inside the app's frame. */
function place(element: Element, frame: Element, height: number) {
  const box = element.getBoundingClientRect(), bounds = frame.getBoundingClientRect();
  const left = Math.max(bounds.left, Math.min(box.left, bounds.right - WIDTH));
  const below = box.bottom + GAP, above = box.top - GAP - height;
  const top = below + height <= bounds.bottom || above < bounds.top ? Math.min(below, bounds.bottom - height) : above;
  return { left, top: Math.max(bounds.top, top) };
}

/**
 * Click to comment (spec 1 §3b, D7c): a popover at the new pin. Enter sends it straight to the PM, Shift+Enter adds a line, « Ajouter au
 * message » puts the pick and the text into the draft instead. Mounted beside the picked area so it reads the host surface's tokens.
 */
export function PointComment({ comment, frame, text }: { readonly comment: PmComment; readonly frame: HTMLElement; readonly text: PmText }) {
  const popover = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ readonly left: number; readonly top: number }>();
  const { chip, element } = comment;
  const { labels } = useChatText();
  const latest = useRef(comment);
  useLayoutEffect(() => { latest.current = comment; });
  const dictation = useDictation({ transcribe: comment.transcribe, labels, target: chip.id,
    onText: (spoken, signal) => { if (!signal.aborted) latest.current.setText(appendToDraft(latest.current.text, spoken)); } });
  useLayoutEffect(() => {
    const update = () => { if (popover.current) setPosition(place(element, frame, popover.current.offsetHeight)); };
    update();
    const observer = new ResizeObserver(update);
    if (popover.current) observer.observe(popover.current);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [element, frame]);
  // Focused once placed, after the click that picked has finished (the point layer holds that click until it ends).
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const frameId = requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frameId);
  }, [chip.id]);
  // A click outside that the point layer does not take (the conversation, the strip): the pick is settled first.
  useEffect(() => {
    const onDown = (event: PointerEvent) => { if (popover.current && !event.composedPath().includes(popover.current)) latest.current.outside(); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  const empty = !comment.text.trim();
  const listening = dictation.phase === 'recording' || dictation.phase === 'starting';
  return createPortal(<div ref={popover} role="dialog" aria-label={text.commentOn(chip.kind, chip.label)} data-feedback-ignore="" data-testid="pm-comment"
    className="fixed z-50 flex w-80 flex-col gap-2 rounded-pm-popover border bg-background px-3 py-2.5 text-foreground shadow-pm-popover"
    style={position ? { left: position.left, top: position.top } : { visibility: 'hidden', left: 0, top: 0 }}>
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center rounded-pm-round bg-pm-mark text-[10px] font-bold text-pm-mark-foreground">{chip.number}</span>
      <span className="min-w-0 truncate"><b className="font-semibold text-pm-label">{chip.kind} · {chip.label}</b> · {chip.screen}</span>
    </div>
    <span className="flex [&_textarea]:min-h-[42px] [&_textarea]:max-h-[126px] [&_textarea]:resize-none [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:p-0 [&_textarea]:font-[inherit] [&_textarea]:text-sm [&_textarea]:leading-normal [&_textarea]:shadow-none [&_textarea]:!ring-0">
      <Textarea ref={field} data-testid="pm-comment-input" rows={2} value={comment.text} placeholder={text.commentPlaceholder} aria-label={text.commentPlaceholder}
        onChange={event => comment.setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!empty) comment.submit(); } }} />
    </span>
    <div className="flex items-center gap-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox data-testid="pm-comment-add" checked={comment.addToMessage} onCheckedChange={value => comment.setAddToMessage(value)} />{text.addToMessage}</label>
      {comment.transcribe && <Button variant="ghost" size="icon" data-testid="pm-comment-mic" data-state={dictation.phase} aria-pressed={listening} aria-label={text.dictate} title={text.dictate}
        disabled={dictation.phase === 'transcribing'} onClick={() => { if (dictation.phase === 'idle') dictation.start(); else dictation.finish(); }} className="min-h-[30px] min-w-[30px] size-[30px]" style={sendScope}>
        {dictation.phase === 'transcribing' ? <Loader2Icon className="size-[15px] animate-spin motion-reduce:animate-none" aria-hidden="true" />
          : listening ? <SquareIcon className="size-[13px]" aria-hidden="true" /> : <MicIcon className="size-[15px]" aria-hidden="true" />}</Button>}
      <span className="flex [&_button:disabled]:bg-pm-send-idle [&_button:disabled]:opacity-100">
        <Button size="icon" data-testid="pm-comment-send" aria-label={text.sendToPm} title={text.sendToPm} disabled={empty} onClick={comment.submit} className="min-h-[30px] min-w-[30px] size-[30px]" style={sendScope}>
          <ArrowUpIcon className="size-3.5" strokeWidth={2.5} aria-hidden="true" /></Button>
      </span>
    </div>
    {dictation.problem && <p role="alert" className="m-0 text-xs text-destructive">{dictation.problem}</p>}
  </div>, frame.parentElement ?? frame.ownerDocument.body);
}
