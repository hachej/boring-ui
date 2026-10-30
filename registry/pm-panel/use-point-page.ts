'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MASKED_NAME, accessibleNameOf, anchorOf, createOverlay, createPicker } from '@hachej/boring-feedback/page';
import type { AppElementAnchor, PrivacyPolicy } from '@hachej/boring-feedback/page';
import { feedbackLabels, feedbackLabelsFr } from '../feedback/feedback-labels';
import { captureElement } from './capture';
import type { PmText } from './pm-text';

/** One element picked on the page: everything the chat needs, none of it a live DOM reference, so it can cross to a sibling frame. */
export interface PointPick {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly screen: string;
  readonly box: readonly [number, number, number, number];
  readonly anchor: AppElementAnchor;
  readonly image: { readonly mimeType: string; readonly data: string };
}
export interface PointPin { readonly id: string; readonly number: number }

/** The picker's overlay is the pin layer's host only while picking; pins are drawn by the overlay below (corner pins, the element's radius). */
const PICK_STYLES = '.box[data-tone="pinned"] { display: none; } .label { display: none; } .box[data-tone="hover"] { border-width: var(--pm-mark-width); } @media (hover: none) { .box[data-tone="hover"] { display: none; } }';
/** Pins: a circle centred on the element's top-right corner, accent fill, contrasting number (spec R3); the accent outline (35% app, 60% Studio) and a light fill. Every value is a theme token. */
const PIN_STYLES = '.box { border-style: solid; border-width: var(--pm-mark-width); border-color: color-mix(in srgb, var(--pm-mark) var(--pm-mark-line), transparent); background: color-mix(in srgb, var(--pm-mark) 6%, transparent); }'
  + ' .label { box-sizing: border-box; min-width: 24px; height: 24px; padding: 0 7px; border-radius: var(--pm-radius-round); display: flex; align-items: center; justify-content: center;'
  + ' background: var(--pm-mark); color: var(--pm-mark-foreground); font-family: var(--font-sans, inherit); font-size: 12px; font-weight: 700; line-height: 1; transform: translate(-50%, -50%); }';
/** A tap lands on the innermost node; the pick is the nearest element a person would name (a card, a gauge, a button, a field). */
const NAMED = 'button, a[href], input, select, textarea, summary, details, img, svg[role], [role=meter], [role=progressbar], [role=article], article, [role=region], [role=group], [role=listitem], li, [role=button], [role=link], [role=img], [aria-label]';
function meaningful(element: Element, root: Element): Element {
  const named = element.closest(NAMED);
  return named && root.contains(named) ? named : element;
}
const HEADING = 'h1, h2, h3, h4, h5, h6, [role=heading]';
/**
 * Spec 1 §3's label for an element without an accessible name: its own heading, its visible text, then the nearest heading around it.
 * Read through the privacy policy, like the name and the capture: text the capture masks never becomes a label (the kind stands in).
 */
function labelOf(element: Element, root: Element, policy: PrivacyPolicy): string | undefined {
  const readable = (node: Element | null) => { const name = node ? accessibleNameOf(node, policy) : MASKED_NAME; return name === MASKED_NAME ? undefined : name; };
  const own = readable(element.querySelector(HEADING)) ?? readable(element);
  if (own) return own;
  for (let around = element.parentElement; around && root.contains(around); around = around.parentElement) {
    const heading = readable(around.querySelector(HEADING));
    if (heading) return heading;
  }
  return undefined;
}

interface PointPageOptions {
  /** A click or tap on the page picks. */
  readonly picking: boolean;
  /** The numbered picks to draw on the page. */
  readonly pins: readonly PointPin[];
  readonly page: HTMLElement | null;
  readonly screen: string;
  readonly policy: PrivacyPolicy;
  readonly text: PmText;
  /** Called first on a pick; `true` swallows it (an open comment popover treats the click as a click outside). */
  readonly intercept?: () => boolean;
  readonly onPick: (pick: PointPick, element: Element) => void;
  /** Tapping an element already picked removes that pick. */
  readonly onUnpick: (id: string) => void;
  readonly onProblem: (message: string) => void;
}

/** The page half of pointing, in whichever frame shows the app: the picker, the capture and the pins. It owns no chip, draft or message. */
export function usePointPage({ picking, pins, page, screen, policy, text, intercept, onPick, onUnpick, onProblem }: PointPageOptions): void {
  const elements = useRef(new Map<string, Element>());
  const seen = useRef(new Set<string>());
  const sequence = useRef(0);
  const latest = useRef({ pins, intercept, onPick, onUnpick, onProblem });
  useLayoutEffect(() => { latest.current = { pins, intercept, onPick, onUnpick, onProblem }; });
  const root = page?.closest('[data-pm-layout]') ?? page;
  useEffect(() => {
    if (!picking || !root) return;
    const picker = createPicker({ root, policy, styles: PICK_STYLES, tap: 'pick', wheel: false, keys: 'outside-ignored',
      onChange: current => { if (current.refusal) latest.current.onProblem(text.locale === 'fr' ? 'Cet élément n’est pas accessible ici. Essayez son titre ou un autre élément.' : 'This element is not accessible here. Try its title or another element.'); },
      onPick: picked => {
        const handlers = latest.current;
        if (handlers.intercept?.()) return;
        const element = meaningful(picked, root);
        for (const [id, chosen] of elements.current) if (chosen === element) { handlers.onUnpick(id); return; }
        if (handlers.pins.length >= 20) { handlers.onProblem('20 éléments maximum par message.'); return; }
        const capture = anchorOf(element, policy, { root });
        if (capture.kind !== 'captured') { handlers.onProblem('Cet élément ne peut pas être joint.'); return; }
        try {
          const anchor = capture.anchor, image = captureElement(element, policy), box = element.getBoundingClientRect();
          const words = text.locale === 'en' ? feedbackLabels : feedbackLabelsFr;
          const role = anchor.signals.role ?? element.localName, unknown = words.element(undefined, undefined), named = words.element(role, undefined);
          const kind = named === unknown ? (text.locale === 'en' ? 'Text' : 'Texte') : named;
          const name = anchor.signals.name ?? labelOf(element, root, policy) ?? kind;
          // Time-based: a reloaded app frame restarts its count while the PM frame still holds earlier picks.
          const id = `pm-${Date.now().toString(36)}-${++sequence.current}`;
          elements.current.set(id, element);
          handlers.onPick({ id, kind, label: name.length > 40 ? `${name.slice(0, 39)}…` : name, screen, box: [box.x, box.y, box.width, box.height], anchor, image }, element);
        } catch { handlers.onProblem('La capture de cet élément est indisponible. Réessayez.'); }
      } });
    void picker.start();
    return () => picker.dispose();
  }, [picking, policy, root, screen, text]);
  useEffect(() => {
    // A pick leaves once its pin has been drawn and is gone. One not yet confirmed may still be on its way from a sibling frame.
    const current = new Set(pins.map(pin => pin.id));
    for (const id of elements.current.keys()) if (seen.current.has(id) && !current.has(id)) { elements.current.delete(id); seen.current.delete(id); }
    for (const id of current) seen.current.add(id);
    if (!pins.length || !root) return;
    // Mounted beside the picked area (never inside it), so the pins read the host surface's theme tokens.
    const overlay = createOverlay({ document: root.ownerDocument, styles: PIN_STYLES, labels: 'corner', shape: 'element', mount: root.parentElement ?? root.ownerDocument.body, ...(page ? { clip: page } : {}) });
    const drawn = new Map<Element, string[]>();
    for (const pin of pins) {
      const element = elements.current.get(pin.id);
      if (!element?.isConnected || !element.getClientRects().length) continue;
      drawn.set(element, [...(drawn.get(element) ?? []), String(pin.number)]);
    }
    overlay.draw([...drawn].map(([element, numbers]) => ({ element, label: numbers.join(' '), tone: 'hover' as const })));
    return () => overlay.dispose();
  }, [pins, root, screen, page]);
}

const noPins: readonly PointPin[] = [];
export const usePins = (chips: readonly PointPin[], visible: boolean): readonly PointPin[] =>
  useMemo(() => visible && chips.length ? chips.map(({ id, number }) => ({ id, number })) : noPins, [chips, visible]);
