'use client';

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '../utils/utils';
import type { PointChip } from './point-state';
import { MARKER_PATTERN, marker } from './point-state';
import { clock, pmTextFr } from './pm-text';
import type { PmText } from './pm-text';

interface Props {
  readonly text: string;
  readonly selections: readonly PointChip[];
  readonly onText: (text: string) => void;
  readonly onCaret: (offset: number) => void;
  readonly onRemove: (id: string) => void;
  readonly onSend: () => void;
  readonly disabled: boolean;
  readonly focus?: boolean | undefined;
  readonly preset?: 'touch' | 'desktop';
  readonly labels?: PmText;
  readonly placeholder?: ReactNode;
  readonly meta?: string | undefined;
}

/** Serialize text and marker tokens, never the chip labels or remove buttons. */
function words(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return [...node.childNodes].map(words).join('');
  if (!(node instanceof HTMLElement)) return '';
  if (node.dataset.pmMarker) return node.dataset.pmMarker;
  if (node.tagName === 'BR') return '\n';
  const text = [...node.childNodes].map(words).join('');
  return (node.tagName === 'DIV' || node.tagName === 'P') && node.previousSibling ? `\n${text}` : text;
}

/** Spec 1 §5: number badge · bold `Kind · Label` · muted timestamp when dictated · ×. Touch: a pill with a dark badge; desktop: ① on a flat pill. */
export function PointChipView({ chip, preset = 'touch', labels = pmTextFr, onRemove, sent = false }: { readonly chip: Pick<PointChip, 'number' | 'kind' | 'label' | 'screen'> & { readonly at: number | null }; readonly preset?: 'touch' | 'desktop'; readonly labels?: PmText; readonly onRemove?: () => void; readonly sent?: boolean }) {
  const touch = preset === 'touch';
  return <span data-testid={sent ? 'pm-inline-selection' : 'pm-chip'} data-n={chip.number} data-dense="" title={`${chip.screen} · ${chip.kind} · ${chip.label}`}
    className={cn('inline-flex max-w-full items-center gap-1 rounded-pm-round align-middle text-xs leading-normal',
      touch ? cn('py-px pl-0.5 ring-1 ring-inset ring-pm-line', sent ? 'bg-background pr-2' : 'bg-muted pr-1.5') : cn('px-2 py-px', sent ? 'bg-background' : 'bg-muted'))}>
    {touch ? <span aria-hidden="true" className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-pm-round bg-pm-mark text-[10px] font-bold text-pm-mark-foreground">{chip.number}</span>
      : <span aria-hidden="true">{marker(chip.number)}</span>}
    <span className="sr-only">{chip.number} </span>
    <span className={cn('min-w-0 truncate', touch && 'font-bold')}>{chip.kind} · {chip.label}</span>
    {chip.at !== null && <span className="shrink-0 text-pm-hint tabular-nums">{clock(chip.at)}</span>}
    {onRemove && <Button variant="ghost" size="icon-xs" aria-label={`${labels.remove} ${chip.kind} · ${chip.label}`} title={labels.remove} onMouseDown={event => event.preventDefault()} onClick={onRemove} className="-my-1 -mr-1 -ml-0.5 !min-h-6 !min-w-6 text-pm-hint"><XIcon aria-hidden="true" /></Button>}
  </span>;
}

// Browser edits are left alone. Only an external draft change or chip removal replaces the editable subtree.
const Editor = memo(function Editor({ initial, selections, version: _version, disabled, changed, caret, remove, send, focus, preset, labels, placeholder }: {
  readonly initial: string; readonly selections: readonly PointChip[]; readonly version: number; readonly disabled: boolean;
  readonly changed: (text: string) => void; readonly caret: (offset: number) => void; readonly remove: (id: string) => void; readonly send: () => void; readonly focus: boolean;
  readonly preset: 'touch' | 'desktop'; readonly labels: PmText; readonly placeholder: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null), composing = useRef(false);
  const [hasWords, setHasWords] = useState(Boolean(initial.trim()) || selections.length > 0);
  useLayoutEffect(() => {
    if (!focus || !root.current) return;
    root.current.focus({ preventScroll: true });
    const range = document.createRange(); range.selectNodeContents(root.current); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  }, [focus]);
  const children = useMemo(() => {
    const byMarker = new Map(selections.map(chip => [marker(chip.number), chip]));
    return initial.split(MARKER_PATTERN).map((part, index) => {
      const chip = byMarker.get(part);
      return chip ? <span key={`chip-${chip.id}`} contentEditable={false} data-pm-marker={part} className="inline-flex max-w-full align-middle">
        <PointChipView chip={chip} preset={preset} labels={labels} onRemove={() => remove(chip.id)} /></span> : <span key={`text-${index}`}>{part}</span>;
    });
  }, [initial, selections, remove, preset, labels]);
  /** The caret never rests inside an atomic chip: it moves to just after it. */
  const settle = () => {
    const selection = window.getSelection(), node = root.current;
    if (!node || !selection?.anchorNode || !node.contains(selection.anchorNode)) return;
    const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement;
    const chip = anchor?.closest('[data-pm-marker]');
    if (chip && node.contains(chip)) {
      const range = document.createRange(); range.setStartAfter(chip); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
    }
    const range = document.createRange(); range.selectNodeContents(node);
    const current = selection.getRangeAt(0);
    range.setEnd(current.startContainer, current.startOffset);
    caret(words(range.cloneContents()).length);
  };
  return <div className="relative w-full min-w-0"><div ref={root} role="textbox" aria-label="Message" aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning data-testid="composer-input"
    className={cn('max-h-52 min-h-16 w-full min-w-0 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-3 pt-2.5 outline-none', preset === 'touch' ? 'text-[15px] leading-[1.9]' : 'text-sm leading-[1.7]')}
    onInput={event => { const text = [...event.currentTarget.childNodes].map(words).join(''); setHasWords(Boolean(text.trim())); changed(text); settle(); }} onKeyUp={settle} onMouseUp={settle} onFocus={settle}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); }}
    onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229 && !globalThis.matchMedia?.('(pointer: coarse)').matches) { event.preventDefault(); send(); }
    }}>{children}</div>{!hasWords && <span aria-hidden="true" data-slot="composer-placeholder" className="pointer-events-none absolute inset-x-3 top-2.5 text-muted-foreground">{placeholder}</span>}</div>;
}, (before, after) => before.version === after.version && before.disabled === after.disabled && before.focus === after.focus && before.preset === after.preset);

export function InlinePointInput(props: Props) {
  const signature = props.selections.map(chip => `${chip.id}:${chip.number}`).join(',');
  const [view, setView] = useState({ initial: props.text, expected: props.text, signature, version: 0 });
  if (props.text !== view.expected || signature !== view.signature) setView({ initial: props.text, expected: props.text, signature, version: view.version + 1 });
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const remove = useMemo(() => (id: string) => latest.current.onRemove(id), []);
  const changed = useMemo(() => (text: string) => {
    const selected = latest.current;
    setView(current => ({ ...current, expected: text })); selected.onText(text);
    // Backspace over a chip removes the whole chip, its pin and its capture.
    for (const chip of selected.selections) if (selected.text.includes(marker(chip.number)) && !text.includes(marker(chip.number))) selected.onRemove(chip.id);
  }, []);
  return <div className="flex w-full min-w-0 flex-col">
    <Editor key={view.version} initial={view.initial} selections={props.selections} version={view.version} disabled={props.disabled} changed={changed} caret={offset => latest.current.onCaret(offset)} remove={remove}
      send={() => { if (!latest.current.disabled) latest.current.onSend(); }} focus={props.focus ?? false} preset={props.preset ?? 'touch'} labels={props.labels ?? pmTextFr} placeholder={props.placeholder} />
    {props.meta && <p data-testid="pm-meta" className="m-0 px-3 pt-1 text-xs text-muted-foreground">{props.meta}</p>}
  </div>;
}
