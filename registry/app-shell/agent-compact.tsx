'use client';

// The phone placement: the bottom drawer with its peek, half and full snap points.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Loader2Icon, MicIcon } from '../_shared/icons';
// Behaviour only: Base UI's keyboard-inset provider for the host drawer's content. It renders nothing visible.
import * as BaseDrawerParts from '@base-ui/react/drawer';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { voiceClock } from '../pi-chat/config';
import { cn } from '../utils/utils';
import { useBackLayer } from '../utils/back';
import { useVisualViewport } from './use-visual-viewport';
import { FOLDED_FIELD, FULL, HALF, HOLD_MS, PEEK_BAR_REM, PEEK_REM, Z, useInternal } from './layer-context';
import type { Snap } from './layer-context';
import { NEEDS_YOU, VoiceProblem } from './agent-bar-parts';
import { ChatSlot, Header, useTitle } from './agent-chats';

/**
 * What a close request from the drawer becomes. A swipe, an outside press, a lost focus and Escape never close the layer: they step down
 * to peek (half without an `agent`), so the modal state goes and the coach stays reachable. Only the Close control closes it. `reason` is
 * Base UI's `details.reason` (`'swipe'`, `'outside-press'`, `'focus-out'`, `'escape-key'`, `'close-watcher'`, `'close-press'`, `'trigger-press'`,
 * `'imperative-action'`, `'none'`).
 */
export function nextSnapOnClose(reason: string, hasPeek: boolean): 'peek' | 'half' | 'close' {
  return reason === 'swipe' || reason === 'outside-press' || reason === 'focus-out' || reason === 'escape-key' ? (hasPeek ? 'peek' : 'half') : 'close';
}

/**
 * Whether a close request comes from something the layer does not own: a full-screen overlay portalled above it (`[data-boring-overlay]`,
 * for example the composer's camera). Its taps count as outside presses and its focus as a focus-out of the drawer, but they must change
 * nothing: the caller cancels the request and leaves the snap alone. Only those three reasons are looked at, and the event target, the
 * related target (focus-out) or the focused element may be the overlay.
 */
export function isOverlayEvent(details: { readonly reason: string; readonly event?: Event | undefined }): boolean {
  if (details.reason !== 'outside-press' && details.reason !== 'focus-out' && details.reason !== 'escape-key') return false;
  const inside = (node: unknown) => node instanceof Element && node.closest('[data-boring-overlay]') !== null;
  const event = details.event as (Event & { relatedTarget?: EventTarget | null }) | undefined;
  return inside(event?.target) || inside(event?.relatedTarget) || inside(globalThis.document?.activeElement);
}
const toSnap = (point: number | string | null, peekPoint: string): Snap | null =>
  point === peekPoint ? 'peek' : point === HALF ? 'half' : point === FULL ? 'full' : null;

/** `bar` on a phone, at rest: the work and the reply as a card right above the field, inside the peek (which grows by its height). The page stays visible behind it. */
function PhoneCardSlot() {
  const { setPhoneCard, setCardPx } = useInternal();
  const node = useRef<HTMLDivElement | null>(null);
  const place = useCallback((element: HTMLDivElement | null) => { node.current = element; setPhoneCard(element); }, [setPhoneCard]);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const sheet = element.closest('[data-testid=agent-layer-sheet]');
    const measure = () => {
      const footer = sheet?.querySelector<HTMLElement>('[data-testid=composer-dock]');
      const handle = sheet?.closest('[data-slot=drawer-popup]')?.querySelector<HTMLElement>('[data-slot=drawer-swipe-handle]');
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      setCardPx(Math.max(0, Math.ceil(element.offsetHeight + (footer?.offsetHeight ?? 0) + (handle?.offsetHeight ?? 0) - PEEK_BAR_REM * rem)));
      if (footer) observer?.observe(footer);
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    measure();
    observer?.observe(element);
    const mutation = new MutationObserver(measure);
    if (sheet) mutation.observe(sheet, { childList: true, subtree: true });
    return () => { observer?.disconnect(); mutation.disconnect(); setCardPx(0); };
  }, [setCardPx]);
  return <div ref={place} data-testid="agent-card-slot" className="shrink-0 px-2 empty:hidden" />;
}

export function CompactSheet({ pointing }: { readonly pointing: boolean }) {
  const layer = useInternal();
  const { snap, agent, voice } = layer;
  const hasPeek = Boolean(agent);
  const { text, title } = useTitle();
  const liveViewport = useVisualViewport();
  const closeRef = useRef<HTMLButtonElement>(null);
  const vetoed = useRef(false);
  // Set while the layer closes; cleared when it opens again (a close is final until the trigger or a choice opens the layer).
  const closing = useRef(false);
  useEffect(() => { if (snap !== 'closed') closing.current = false; }, [snap]);
  const open = snap !== 'closed' && layer.showing !== 'improve' && !pointing;
  const peek = snap === 'peek';
  const points = useMemo(() => hasPeek ? [layer.peekPoint, HALF, FULL] : [HALF, FULL], [hasPeek, layer.peekPoint]);
  const value = peek ? layer.peekPoint : snap === 'full' ? FULL : HALF;
  const recording = voice.phase !== 'idle';
  // While the person talks the sheet holds still: the viewport height and the keyboard inset are pinned at what they were when the recording
  // began, the composer takes no focus and no keyboard, so nothing moves under the finger on the microphone.
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  // The page reserves the folded stack above the tabs, independent of the sheet's snap.
  useLayoutEffect(() => {
    const popup = sheet?.closest<HTMLElement>('[data-slot=drawer-popup]');
    const body = sheet;
    if (!layer.bar || !popup || !body) return;
    const root = document.documentElement;
    const measure = () => {
      const footer = body.querySelector<HTMLElement>('[data-testid=composer-dock]');
      const header = body.querySelector<HTMLElement>('[data-testid=agent-layer-header]');
      body.style.setProperty('--app-shell-field-height', `${footer?.offsetHeight ?? 0}px`);
      body.style.setProperty('--app-shell-sheet-header-height', `${header?.offsetHeight ?? 0}px`);
      if (footer) observer.observe(footer);
      if (header) observer.observe(header);
      root.style.setProperty('--app-shell-bar-height', `${Math.max(0, parseFloat(layer.peekPoint) - layer.tabbar)}px`);
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(body);
    const position = new MutationObserver(measure);
    position.observe(popup, { attributes: true, attributeFilter: ['style', 'data-bar-sheet'] });
    // The persistent chat mounts inside ChatSlot after the sheet's first measurement.
    position.observe(body, { childList: true, subtree: true });
    return () => { observer.disconnect(); position.disconnect(); root.style.removeProperty('--app-shell-bar-height'); };
  }, [layer.bar, layer.peekPoint, layer.tabbar, sheet]);
  const idleViewport = useRef(liveViewport);
  // eslint-disable-next-line react-hooks/refs -- ref cache: the last viewport seen while not recording, pinned during a recording; no setState during render
  if (!recording) idleViewport.current = liveViewport;
  // eslint-disable-next-line react-hooks/refs -- reads the pinned viewport cached above in this same render
  const vv = recording ? idleViewport.current : liveViewport;
  useLayoutEffect(() => {
    const popup = sheet?.closest<HTMLElement>('[data-slot=drawer-popup]');
    if (!recording || !sheet) return;
    const previousBottom = popup?.style.bottom ?? '';
    if (popup) popup.style.bottom = getComputedStyle(popup).bottom;
    const inputs = [...sheet.querySelectorAll<HTMLTextAreaElement>('[data-testid=composer-input]')].map(input => ({ input, mode: input.getAttribute('inputmode'), readOnly: input.readOnly }));
    for (const { input } of inputs) { input.readOnly = true; input.setAttribute('inputmode', 'none'); }
    return () => {
      if (popup) popup.style.bottom = previousBottom;
      for (const { input, mode, readOnly } of inputs) { input.readOnly = readOnly; if (mode === null) input.removeAttribute('inputmode'); else input.setAttribute('inputmode', mode); }
    };
  }, [recording, sheet]);

  // At half and full the sheet is modal: the page, the trigger included, is inert, so a tap on the trigger lands elsewhere and would count as an
  // outside press (down to peek). It still means what the trigger means: close. A trigger that gets its own press, or one under the sheet, is left alone.
  const { close, triggerUntil } = layer;
  useEffect(() => {
    if (!open || peek) return;
    const triggerAt = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-agent-trigger], [data-slot=drawer-popup], [data-boring-overlay]')) return null;
      return [...document.querySelectorAll('[data-agent-trigger]')].find(trigger => {
        const box = trigger.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      }) ?? null;
    };
    let press: { readonly trigger: Element; readonly id: number; readonly at: number } | null = null;
    const down = (event: PointerEvent) => {
      if (press) return;
      const trigger = triggerAt(event);
      if (!trigger) return;
      press = { trigger, id: event.pointerId, at: Date.now() };
      triggerUntil.current = press.at + 500;
    };
    const up = (event: PointerEvent) => {
      if (press?.id !== event.pointerId) return;
      const { trigger, at } = press;
      press = null;
      // A tap, on the trigger it began on. A long press is not one: this trigger records only from a closed or peek layer.
      if (triggerAt(event) === trigger && Date.now() - at < HOLD_MS) close();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
    };
  }, [open, peek, close, triggerUntil]);

  // The sheet stops under the page header it opens over, so the trigger there is not covered: at full the sheet would otherwise reach 1.5rem from the top and sit on it.
  const [measuredClear, setTriggerClear] = useState(0);
  const triggerClear = open && (layer.bar || !peek) ? measuredClear : 0;
  useLayoutEffect(() => {
    // Keep the bar's popup height stable across snaps, including while its transcript is folded.
    if (!open || (peek && !layer.bar)) return;
    // Follows the real geometry while open: a header that grows later (an async leading control) moves the trigger down. The lowest of the triggers in the top half counts.
    // State is set only from the callbacks below (the first call is the observer's initial one), never synchronously in this effect.
    const measure = () => {
      let bottom = 0;
      for (const trigger of document.querySelectorAll('[data-agent-trigger]')) {
        const box = trigger.getBoundingClientRect();
        if (box.bottom > 0 && box.bottom < window.innerHeight / 2) bottom = Math.max(bottom, box.bottom);
      }
      setTriggerClear(bottom ? Math.ceil(bottom + 4) : 0);
    };
    const size = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    const first = requestAnimationFrame(measure);
    // The header can change without the trigger's own box changing: watch the header's size and its subtree's attributes and children, and the page.
    for (const trigger of document.querySelectorAll('[data-agent-trigger]')) {
      const header = trigger.closest('header, [role=banner]');
      for (const node of [trigger, trigger.parentElement, header]) if (node) size?.observe(node);
      if (header) mutation?.observe(header, { attributes: true, childList: true, subtree: true });
    }
    size?.observe(document.body);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    document.addEventListener('transitionend', measure, true);
    return () => {
      cancelAnimationFrame(first); size?.disconnect(); mutation?.disconnect();
      window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure);
      document.removeEventListener('transitionend', measure, true);
    };
  }, [open, peek, layer.bar, vv?.height]);

  // While « Améliorer l'app » shows, the PM panel owns the layer's Back entry (AgentLayerProvider).
  useBackLayer((snap === 'half' || snap === 'full') && layer.showing !== 'improve', layer.close, 'agent');

  // Base UI's snap offset belongs to the popup. The bar passes its computed value down so the field can counter-translate it,
  // while the transcript's scroll window shortens under the header. Other composer modes keep their snap padding.
  // The popup is portalled to the body, outside the shell root: it is given the measured tab bar height and the z-values explicitly.
  // `bar` (AC-20): Ouvert on a phone is the half, and the tabs stay in view under it (the popup's part over them is clipped, as at peek).
  const keepTabs = layer.bar && snap === 'half';
  const keyboardOpen = liveViewport !== null && window.innerHeight - liveViewport.height - liveViewport.top > 80;
  // Full covers the tabs, but keeps their space below the field so expanding only grows the transcript upward.
  const fullInset = keyboardOpen ? 'var(--app-shell-safe-bottom, 0px)' : 'max(var(--app-shell-tabbar, 0px), var(--app-shell-safe-bottom, 0px))';
  const bottomInset = layer.bar && snap === 'full' ? fullInset : 'var(--app-shell-tabbar, 0px)';
  const keyboardPeek = layer.bar && peek && !recording && keyboardOpen;
  const style = { '--app-shell-trigger-clear': `${triggerClear}px`, '--app-shell-vv-height': vv ? `${vv.height}px` : '100dvh', '--app-shell-tabbar': `${layer.tabbar}px`, '--app-shell-peek-height': layer.bar ? `calc(${PEEK_BAR_REM}rem + ${layer.cardPx}px)` : `${PEEK_REM}rem`, '--app-shell-z-layer': Z.layer,
    ...(layer.bar ? { '--app-shell-sheet-offset': 'var(--drawer-snap-point-offset, 0px)' } : {}),
    paddingBottom: layer.bar ? bottomInset : peek ? `calc(var(--drawer-snap-point-offset, 0px) + ${bottomInset})` : 'var(--drawer-snap-point-offset, 0px)',
    // `bar`, folded, with the keyboard up (K-1): the field is not moved to a full screen; the folded sheet rests on the keyboard at its own height (the field and the card),
    // the page stays visible above it. The drawer's snap arithmetic does not know a keyboard at the peek, so it is set aside while the keyboard shows.
    ...(keyboardPeek ? { '--translate-y': '0px', height: 'auto', paddingBottom: 0, clipPath: 'none' } : {}) } as CSSProperties;
  // Entering the modal half or full from the non-modal peek does not rerun Base UI's initial focus: if focus is still on the page, take it to Close.
  const wasPeek = useRef(false);
  useEffect(() => {
    const entering = wasPeek.current && !peek && open;
    wasPeek.current = peek;
    if (!entering) return;
    // The element that held focus when the sheet left peek (a page control now behind the modal). Base UI re-applies its modal guards as the
    // sheet moves, so retake focus once they have settled and again after the slide, but only while focus is still stranded there (or lost to the body).
    const stranded = document.activeElement;
    const take = () => {
      const popup = closeRef.current?.closest('[data-slot=drawer-popup]');
      const active = document.activeElement;
      // Still stranded, or dropped to the body by the modal guards: retake. Focus that went anywhere else is the person's and is left alone.
      if (popup && (active === stranded || active === document.body || active === null) && !popup.contains(active)) closeRef.current?.focus({ preventScroll: true });
    };
    const early = setTimeout(take, 60), late = setTimeout(take, 520);
    return () => { clearTimeout(early); clearTimeout(late); };
  }, [peek, open]);
  // The grabber is the size control of a phone (no strip, no size icon): a tap goes to the next snap (peek, half, full, peek), a drag still snaps freely. Its hit area is 44 px, the pill stays 4.
  const cycle = useRef(() => {});
  useEffect(() => { cycle.current = () => { if (snap === 'full') layer.close(); else layer.setSnap(snap === 'half' ? 'full' : 'half'); }; });
  useEffect(() => {
    const handle = layer.bar ? sheet?.closest('[data-slot=drawer-popup]')?.querySelector<HTMLElement>('[data-slot=drawer-swipe-handle]') : null;
    if (!handle) return;
    const hit = ['before:absolute', 'before:-inset-y-4', 'before:inset-x-6', 'before:content-[""]'];
    handle.classList.add(...hit);
    // The drawer captures the pointer for its swipe, so the press and the release are read on the window, and counted when the press started on the grabber (its 44 px box).
    let down: { readonly x: number; readonly y: number; readonly t: number } | undefined;
    const onDown = (event: PointerEvent) => { const r = handle.getBoundingClientRect(); down = event.clientX >= r.left - 24 && event.clientX <= r.right + 24 && event.clientY >= r.top - 16 && event.clientY <= r.bottom + 16 ? { x: event.clientX, y: event.clientY, t: Date.now() } : undefined; };
    const onUp = (event: PointerEvent) => { const start = down; down = undefined; if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8 && Date.now() - start.t < 400) cycle.current(); };
    window.addEventListener('pointerdown', onDown, true); window.addEventListener('pointerup', onUp, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); handle.classList.remove(...hit); };
  }, [layer.bar, sheet]);
  // `bar` at half the page stays usable around the sheet (the tabs above all), as at peek: the sheet is not modal there.
  return <Drawer open={open} modal={!peek && !keepTabs} showSwipeHandle swipeDirection="down" snapPoints={points} snapPoint={value}
    onOpenChange={(next, details) => {
      if (next) return;
      if (isOverlayEvent(details)) { details.cancel(); return; }
      // A tap on the tabs kept under the half switches screens; it is not a press outside the conversation.
      if (keepTabs && details.reason === 'outside-press' && details.event?.target instanceof Element && details.event.target.closest('[data-testid=tabbar]')) { details.cancel(); return; }
      const outcome = nextSnapOnClose(details.reason, hasPeek);
      if (outcome === 'close') { closing.current = true; layer.close(); return; }
      details.cancel();
      vetoed.current = true;
      setTimeout(() => { vetoed.current = false; }, 120);
      // Focus leaving the non-modal peek changes nothing, and neither does the click that finished a press on the AgentTrigger (outside the
      // drawer, so it counts as an outside press): the trigger already chose the snap.
      if (details.reason === 'focus-out' || Date.now() < layer.triggerUntil.current) return;
      layer.setSnap(outcome);
    }}
    onSnapPointChange={point => {
      // Vetoing a swipe-close makes the drawer snap back to where it was: that echo must not undo the snap we chose.
      // Base UI also reports the first snap point (peek) as the drawer closes: that echo must not reopen the layer.
      if (vetoed.current || closing.current) return;
      const next = toSnap(point, layer.peekPoint);
      if (next && (next !== 'peek' || hasPeek)) layer.setSnap(next);
    }}>
    <DrawerContent data-testid="agent-layer" aria-label={title} data-state={snap} data-peek={peek} data-bar-sheet={layer.bar && !keyboardPeek || undefined} data-keep-tabs={keepTabs || undefined} initialFocus={() => closeRef.current ?? false} style={style}
      className={cn('app-shell box-border z-(--app-shell-z-layer) data-[swipe-direction=down]:bottom-(--drawer-keyboard-inset,0px) data-[swipe-axis=y]:[--drawer-content-max-height:calc(var(--app-shell-vv-height,100dvh)_-_max(1.5rem,var(--app-shell-trigger-clear,0px)))]',
        // `bar`: full is the whole viewport, no strip of the page above it (the same `full` size as the wide screen's full-screen conversation).
        layer.bar && 'data-[state=full]:data-[swipe-axis=y]:[--drawer-content-max-height:var(--app-shell-vv-height,100dvh)] data-[state=full]:[padding-top:env(safe-area-inset-top)]',
        // The field counter-translates the snap offset; tap changes need no layout animation.
        layer.bar && 'transition-opacity duration-(--duration-fast) motion-reduce:transition-none',
        // A decision waits on the folded card: the sheet takes the bar's warning border and ring.
        layer.bar && NEEDS_YOU,
        // A nested History drawer must not scale or resize the sheet that anchors the one field.
        layer.bar && '[--stack-step:0] [--peek:0px] [--stack-height:var(--drawer-content-height)]',
        // The peek is the top PEEK_REM of the popup; the part that overlaps the tab bar is clipped away, so the tabs stay visible and tappable.
        'data-[peek=true]:not-data-swiping:[clip-path:inset(0_0_calc(100%_-_var(--app-shell-peek-height))_0)]',
        'data-keep-tabs:not-data-swiping:[clip-path:inset(0_0_calc(var(--drawer-snap-point-offset,0px)_+_var(--app-shell-tabbar,0px))_0)]')}>
      <BaseDrawerParts.Drawer.VirtualKeyboardProvider>
        <div ref={setSheet} data-testid="agent-layer-sheet" {...(layer.bar ? { 'data-one-dock': '' } : {})} onFocusCapture={event => { if (!layer.bar && !recording && (event.target as HTMLElement).matches('[data-testid=composer-input]')) layer.setSnap('full'); }}
          className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain',
            // The layer's own header carries the title and Close, so the chat's is hidden. At peek: one line of the last reply above the
            // composer, no empty-state overlay, room for Close.
            '[&_[data-boring=pi-chat]>header]:hidden',
            // At peek: ONE compact row (a one-line input, the microphone and Send; the other composer controls wait for half), and the last
            // reply as a single truncated line above it.
            peek && !layer.bar && ['[&_[data-boring=pi-chat]>.relative]:overflow-hidden [&_[data-boring=pi-chat]>.relative>.pointer-events-none]:hidden',
              '[&_[data-boring=pi-chat]>footer]:px-2 [&_[data-boring=pi-chat]>footer]:pt-1 [&_[data-boring=pi-chat]>footer]:pb-2',
              '[&_[data-testid=transcript]]:gap-0 [&_[data-testid=transcript]]:p-0 [&_[data-testid=transcript]]:px-3 [&_[data-testid=transcript]>*]:max-h-5 [&_[data-testid=transcript]>*]:truncate [&_[data-testid=transcript]_button]:hidden',
              '[&_[data-testid=composer]_[data-slot=input-group]]:flex-row! [&_[data-testid=composer]_[data-slot=input-group]]:items-center',
              '[&_[data-testid=composer-input]]:min-h-11 [&_[data-testid=composer-input]]:max-h-11 [&_[data-testid=composer-input]]:flex-1 [&_[data-testid=composer-input]]:px-4 [&_[data-testid=composer-input]]:py-2.5',
              voice.phase !== 'starting' && voice.phase !== 'recording' && '[&_[data-testid=composer-controls]]:w-auto [&_[data-testid=composer-controls]]:shrink-0 [&_[data-testid=composer-controls]]:py-0 [&_[data-testid=composer-controls]>span.flex-1]:hidden',
              '[&_[data-testid=composer-plus]]:hidden [&_[data-testid=composer-annotate]]:hidden'],
            layer.bar && '[&_[data-testid=composer-dock]]:px-2 [&_[data-testid=composer-dock]]:pt-2 [&_[data-testid=composer-dock]]:pb-4',
            peek && layer.bar && ['[&_[data-boring=pi-chat]>.relative]:hidden [&_[data-testid=conversation-content]]:hidden', FOLDED_FIELD])}>
          {!peek && <Header text={text} title={title} compactSnap={snap} closeRef={closeRef} className={layer.bar ? 'absolute inset-x-0 top-0 z-10 bg-popover' : undefined} />}
          {!peek && <VoiceProblem />}
          {peek && recording && <div aria-hidden="true" data-testid="agent-listening" data-phase={voice.phase} className="sr-only">
            <MicIcon className="size-4 text-destructive" aria-hidden="true" />{voice.phase === 'transcribing' ? <><Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{voiceClock(voice.seconds)}</> : `${text.listening} ${voiceClock(voice.seconds)}`}
          </div>}
          {peek && layer.bar && <PhoneCardSlot />}
          {/* The transcript scrolls and never drags the sheet: only the handle and the title row swipe. */}
          <div data-base-ui-swipe-ignore="" className="flex min-h-0 flex-1 flex-col"><ChatSlot /></div>
        </div>
      </BaseDrawerParts.Drawer.VirtualKeyboardProvider>
    </DrawerContent>
  </Drawer>;
}
