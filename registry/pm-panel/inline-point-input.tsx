'use client';

import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2Icon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PointChip } from './point-state';
import { marker } from './point-state';

interface Props {
  readonly text: string;
  readonly selections: readonly PointChip[];
  readonly onText: (text: string) => void;
  readonly onCaret: (offset: number) => void;
  readonly onRemove: (id: string) => void;
  readonly onSend: () => void;
  readonly disabled: boolean;
  readonly focus?: boolean | undefined;
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

// Browser edits are left alone. Only an external draft change or chip removal replaces the editable subtree.
const Editor = memo(function Editor({ initial, selections, version: _version, disabled, changed, caret, remove, send, focus }: {
  readonly initial: string; readonly selections: readonly PointChip[]; readonly version: number; readonly disabled: boolean;
  readonly changed: (text: string) => void; readonly caret: (offset: number) => void; readonly remove: (id: string) => void; readonly send: () => void; readonly focus: boolean;
}) {
  const root = useRef<HTMLDivElement>(null), composing = useRef(false);
  const [hasWords, setHasWords] = useState(Boolean(initial.trim()));
  useLayoutEffect(() => {
    if (!focus || !root.current) return;
    root.current.focus({ preventScroll: true });
    const range = document.createRange(); range.selectNodeContents(root.current); range.collapse(false);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  }, [focus]);
  const children = useMemo(() => {
    const byMarker = new Map(selections.map(chip => [marker(chip.number), chip]));
    return initial.split(/([①-⑳㉑-㉟㊱-㊿]|\(\d+\))/u).map((part, index) => {
      const chip = byMarker.get(part);
      return chip ? <span key={`chip-${chip.id}`} contentEditable={false} data-pm-marker={part} data-dense="" className="inline-flex max-w-full align-middle"><Badge variant="secondary" title={`${chip.screen} · ${chip.label}`} className="max-w-full">
        <span className="min-w-0 truncate">{part} {chip.kind} · {chip.label}</span><Button variant="ghost" size="icon-xs" aria-label={`Retirer ${chip.label}`} onClick={() => remove(chip.id)}><XIcon data-icon="inline-start" /></Button>
      </Badge></span> : <span key={`text-${index}`}>{part}</span>;
    });
  }, [initial, selections, remove]);
  const trackCaret = () => {
    const selection = window.getSelection(), node = root.current;
    if (!node || !selection?.anchorNode || !node.contains(selection.anchorNode)) return;
    const range = document.createRange(); range.selectNodeContents(node); range.setEnd(selection.anchorNode, selection.anchorOffset);
    caret(words(range.cloneContents()).length);
  };
  return <div className="relative w-full min-w-0"><div ref={root} role="textbox" aria-label="Message" aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning data-testid="composer-input"
    className="max-h-52 min-h-16 w-full min-w-0 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-3 py-2 text-sm outline-none"
    onInput={event => { const text = [...event.currentTarget.childNodes].map(words).join(''); setHasWords(Boolean(text.trim())); changed(text); trackCaret(); }} onKeyUp={trackCaret} onMouseUp={trackCaret}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onPaste={event => { event.preventDefault(); const text = event.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); }}
    onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229 && !globalThis.matchMedia?.('(pointer: coarse)').matches) { event.preventDefault(); send(); }
    }}>{children}</div>{!hasWords && <span aria-hidden="true" data-pm-placeholder="" className="pointer-events-none absolute inset-x-3 top-2 text-sm text-muted-foreground">Décrivez le problème, ou <MousePointer2Icon className="inline size-4 align-text-bottom" aria-hidden="true" /> pour me le montrer.</span>}</div>;
}, (before, after) => before.version === after.version && before.disabled === after.disabled && before.focus === after.focus);

export function InlinePointInput(props: Props) {
  const signature = props.selections.map(chip => chip.id).join(',');
  const [view, setView] = useState({ initial: props.text, expected: props.text, signature, version: 0 });
  if (props.text !== view.expected || signature !== view.signature) setView({ initial: props.text, expected: props.text, signature, version: view.version + 1 });
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const remove = useMemo(() => (id: string) => latest.current.onRemove(id), []);
  const changed = useMemo(() => (text: string) => {
    const selected = latest.current;
    setView(current => ({ ...current, expected: text })); selected.onText(text);
    for (const chip of selected.selections) if (selected.text.includes(marker(chip.number)) && !text.includes(marker(chip.number))) selected.onRemove(chip.id);
  }, []);
  return <Editor key={view.version} initial={view.initial} selections={props.selections} version={view.version} disabled={props.disabled} changed={changed} caret={offset => latest.current.onCaret(offset)} remove={remove} send={() => { if (!latest.current.disabled) latest.current.onSend(); }} focus={props.focus ?? false} />;
}
