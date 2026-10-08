// Pick mode (FEEDBACK.md, "Pointing at elements: the picker"): the element under the pointer is boxed and labelled, ↑ or scrolling up
// selects the parent and ↓ (or scrolling down) the child again, click pins, Shift-click pins several, Esc cancels; Tab and Enter do the
// same from the keyboard; on touch a tap selects and the overlay's Parent, Child and Pin buttons replace the keys.
//
// Picking never activates the page: while pick mode is on, pointer, click, key and submit events are taken in the capture phase on the
// window and stopped, so pressing a Save button pins it without pressing it. Only the overlay (its touch toolbar) and subtrees marked
// `data-feedback-ignore` (the application's own chrome, the agent bar) keep their pointer events. Keys always belong to the picker.
// When pick mode ends, every listener is removed and focus returns to where it was.
//
// Only the given application root is pickable: elements outside it (portals), inside shadow roots or in iframes are never selected.
//
// Continuous picking (`onPick`, used by the feedback session): a click or Enter hands the element to `onPick` and pick mode stays on,
// so the person can pin one element after another. `wheel: false` leaves scrolling to the page, `keys: 'outside-ignored'` lets keys
// typed inside ignored subtrees (a note bubble) reach them, and `suspend(true)` lets every event through to the page until
// `suspend(false)` (the session's "hold Alt to use the app").
import { isExcluded, type PrivacyPolicy } from '../privacy/policy.js';
import { pickerLabel } from './label.js';
import { createOverlay, type OverlayBox, type PickerOverlay } from './overlay.js';

export type PickerMode = 'idle' | 'picking' | 'done';

export interface PickerState {
  readonly mode: PickerMode;
  /** The element the next pin takes. */
  readonly current?: Element;
  /** Its label, from the privacy policy. */
  readonly label?: string;
  readonly pins: readonly Element[];
  /** True once a touch selected: the overlay shows its Parent, Child and Pin buttons. */
  readonly touch: boolean;
  /** Why the element under the pointer cannot be picked (outside the application root). */
  readonly refusal?: string;
  /** Pick mode is on but every event currently reaches the page (`suspend`). */
  readonly suspended: boolean;
}

export type PickerResult = { readonly kind: 'pinned'; readonly elements: readonly Element[] } | { readonly kind: 'cancelled' };

export interface PickerOptions {
  /** The application root: only elements inside it (light DOM, same document) are pickable. */
  readonly root: Element;
  readonly policy: PrivacyPolicy;
  /** A shared overlay; otherwise the picker creates one (with `styles`) and disposes it with itself. */
  readonly overlay?: PickerOverlay;
  readonly styles?: string;
  /** Shift-click and Shift-Enter pin several elements. Default true. */
  readonly multiple?: boolean;
  /** Elements at a viewport point, topmost first. Defaults to `document.elementsFromPoint`. */
  readonly hitTest?: (x: number, y: number) => readonly Element[];
  readonly onChange?: (state: PickerState) => void;
  readonly onFinish?: (result: PickerResult) => void;
  /** Continuous picking: a click, Enter or the touch Pin hands the element here and pick mode stays on. Shift has no effect. */
  readonly onPick?: (element: Element) => void;
  /** The wheel selects the parent and the child (default). False leaves wheel events, and so scrolling, to the page. */
  readonly wheel?: boolean;
  /** `'all'` (default): every key belongs to the picker. `'outside-ignored'`: keys inside ignored subtrees reach them. */
  readonly keys?: 'all' | 'outside-ignored';
}

export interface Picker {
  /** Enters pick mode. Resolves when the person pins (Click, Enter, Done) or cancels (Esc, Cancel, `dispose`). */
  readonly start: () => Promise<PickerResult>;
  readonly cancel: () => void;
  /** Ends with the pins so far, or the current element when nothing is pinned yet. */
  readonly finish: () => void;
  readonly parent: () => void;
  readonly child: () => void;
  /** Pins the current element; with `add`, keeps picking for more. */
  readonly pin: (options?: { readonly add?: boolean }) => void;
  /** Makes an element current (refused when it is not pickable). */
  readonly select: (element: Element) => boolean;
  readonly state: () => PickerState;
  readonly overlay: PickerOverlay;
  /** Draws one element with a note on the same overlay (Show). */
  readonly highlight: (element: Element, note?: string) => void;
  /** While suspended, pick mode stays on but no event is taken: the page works as usual. Resuming takes them again. */
  readonly suspend: (suspended: boolean) => void;
  /** Cancels pick mode if it is on and removes an overlay the picker created. */
  readonly dispose: () => void;
}

/** Elements Tab moves between: what people can act on or name, plus marked elements. */
const TAB_STOPS = 'a[href],button,input,select,textarea,summary,[tabindex],[role],[contenteditable],h1,h2,h3,h4,h5,h6,label,img,table,[data-feedback-id],[data-testid]';
const POINTER_EVENTS = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend', 'dragstart', 'selectstart'] as const;
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;

/** Why an element cannot be picked, or undefined when it can. */
export function pickRefusal(element: Element, root: Element): string | undefined {
  if (element.ownerDocument !== root.ownerDocument) return 'the element is in another document (an iframe)';
  if (!element.isConnected) return 'the element is not in the page';
  if (element.getRootNode() !== element.ownerDocument) return 'the element is inside a shadow root';
  if (isExcluded(element)) return 'the element is inside an ignored subtree or the feedback overlay';
  if (element !== root && !root.contains(element)) return 'the element is outside the application root';
  return undefined;
}

export function createPicker(options: PickerOptions): Picker {
  const { root, policy, onPick, wheel = true, keys = 'all' } = options;
  const multiple = onPick ? false : options.multiple ?? true;
  const document = root.ownerDocument;
  const view = document.defaultView;
  if (!view) throw new TypeError('The application root must be in a document with a window');
  const ownsOverlay = options.overlay === undefined;
  const overlay = options.overlay ?? createOverlay({ document, ...(options.styles !== undefined ? { styles: options.styles } : {}) });
  const hitTest = options.hitTest ?? ((x: number, y: number) => document.elementsFromPoint(x, y));

  let mode: PickerMode = 'idle';
  let current: Element | undefined;
  let refusal: string | undefined;
  let pins: Element[] = [];
  let touch = false;
  let suspended = false;
  let lastPointer = 'mouse';
  /** Children left by ↑, so ↓ returns along the same path. */
  let trail: Element[] = [];
  let focus: Element | null = null;
  let settle: ((result: PickerResult) => void) | undefined;
  const removers: (() => void)[] = [];

  const state = (): PickerState => Object.freeze({
    mode, pins: Object.freeze([...pins]), touch, suspended,
    ...(current ? { current, label: pickerLabel(current, policy) } : {}),
    ...(refusal !== undefined ? { refusal } : {}),
  });

  const redraw = (): void => {
    const boxes: OverlayBox[] = pins.map(element => ({ element, label: pickerLabel(element, policy), tone: 'pinned' }));
    if (mode === 'picking' && !suspended && current && !pins.includes(current)) boxes.push({ element: current, label: pickerLabel(current, policy), tone: 'hover' });
    overlay.draw(boxes);
    overlay.toolbar(mode === 'picking' && !suspended && touch ? {
      parent: () => move('up'), child: () => move('down'), pin: () => pin(), cancel: () => end({ kind: 'cancelled' }),
      ...(pins.length ? { done: () => finish() } : {}),
    } : undefined);
  };
  const changed = (): void => { redraw(); options.onChange?.(state()); };

  const pickable = (element: Element): boolean => pickRefusal(element, root) === undefined;
  const choose = (element: Element | undefined, keepTrail = false): void => {
    if (!keepTrail) trail = [];
    current = element;
    refusal = undefined;
    changed();
  };
  const select = (element: Element): boolean => {
    if (mode !== 'picking' || !pickable(element)) return false;
    choose(element);
    return true;
  };

  /** The topmost pickable element at a point, skipping the overlay and ignored subtrees; anything else on top refuses the point. */
  const at = (x: number, y: number): { readonly element?: Element; readonly refusal?: string } => {
    for (const element of hitTest(x, y)) {
      if (element === overlay.host || isExcluded(element)) continue;
      const reason = pickRefusal(element, root);
      return reason === undefined ? { element } : { refusal: reason };
    }
    return {};
  };
  const hover = (x: number, y: number): void => {
    const found = at(x, y);
    if (found.element === current && found.refusal === refusal) return;
    trail = [];
    current = found.element;
    refusal = found.refusal;
    changed();
  };

  const move = (direction: 'up' | 'down'): void => {
    if (mode !== 'picking' || !current) return;
    if (direction === 'up') {
      const parent = current.parentElement;
      if (!parent || current === root || !pickable(parent)) return;
      trail.push(current);
      choose(parent, true);
      return;
    }
    const back = trail.pop();
    const next = back ?? Array.from(current.children).find(pickable);
    if (next) choose(next, true);
  };

  const stops = (): Element[] => Array.from(root.querySelectorAll(TAB_STOPS)).filter(element => pickable(element) && !element.closest('[hidden]'));
  const tab = (backward: boolean): void => {
    const list = stops();
    if (!list.length) return;
    const index = current ? list.indexOf(current) : -1;
    const next = index < 0 ? (backward ? list.length - 1 : 0) : (index + (backward ? -1 : 1) + list.length) % list.length;
    choose(list[next]);
  };

  const pin = ({ add = false } = {}): void => {
    if (mode !== 'picking' || suspended || !current) return;
    if (onPick) { onPick(current); return; }
    if (add && multiple) {
      pins = pins.includes(current) ? pins.filter(element => element !== current) : [...pins, current];
      changed();
      return;
    }
    if (!pins.includes(current)) pins = [...pins, current];
    finish();
  };
  const finish = (): void => {
    if (mode !== 'picking') return;
    if (!pins.length && current) pins = [current];
    if (!pins.length) { end({ kind: 'cancelled' }); return; }
    end({ kind: 'pinned', elements: Object.freeze([...pins]) });
  };

  const end = (result: PickerResult): void => {
    if (mode !== 'picking') return;
    mode = 'done';
    for (const remove of removers.splice(0)) remove();
    if (result.kind === 'cancelled') pins = [];
    current = undefined;
    refusal = undefined;
    touch = false;
    suspended = false;
    trail = [];
    changed();
    const restore = focus;
    focus = null;
    if (restore && restore.isConnected && typeof (restore as HTMLElement).focus === 'function') {
      try { (restore as HTMLElement).focus({ preventScroll: true }); } catch { /* not focusable any more */ }
    }
    const done = settle;
    settle = undefined;
    options.onFinish?.(result);
    done?.(result);
  };

  // --- events -------------------------------------------------------------------------------------------------------------------

  const stop = (event: Event): void => { if (event.cancelable) event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
  /** Pointer events on the overlay's toolbar and in ignored subtrees keep working; everything else is the picker's. */
  const passes = (event: Event): boolean => event.composedPath().some(target => target === overlay.host || (isElement(target) && target.hasAttribute('data-feedback-ignore')));
  const point = (event: Event): { readonly x: number; readonly y: number } | undefined => {
    const touches = (event as TouchEvent).changedTouches;
    if (touches && touches.length) { const first = touches[0]!; return { x: first.clientX, y: first.clientY }; }
    const mouse = event as MouseEvent;
    return typeof mouse.clientX === 'number' ? { x: mouse.clientX, y: mouse.clientY } : undefined;
  };

  const onPointer = (event: Event): void => {
    if (passes(event)) return;
    const type = event.type;
    const pointerType = (event as PointerEvent).pointerType;
    if (type === 'pointerdown' && pointerType) lastPointer = pointerType;
    if (type === 'touchstart') lastPointer = 'touch';
    const tapped = type === 'pointerup' && pointerType === 'touch';
    if (tapped || (type === 'touchend' && lastPointer === 'touch')) {
      const where = point(event);
      if (where) { touch = true; const found = at(where.x, where.y); trail = []; current = found.element ?? current; refusal = found.refusal; changed(); }
    } else if (type === 'click' && lastPointer !== 'touch') {
      const where = point(event);
      const mouse = event as MouseEvent;
      if (where && (mouse.detail > 0 || where.x !== 0 || where.y !== 0)) { const found = at(where.x, where.y); if (found.element && found.element !== current) choose(found.element); }
      pin({ add: mouse.shiftKey });
    }
    // touchstart is not cancelled, so the page still scrolls under a finger; touchend is, so no click is synthesized.
    if (type === 'touchstart') { event.stopPropagation(); event.stopImmediatePropagation(); return; }
    stop(event);
  };
  const inIgnored = (event: Event): boolean => event.composedPath().some(target => isElement(target) && target.hasAttribute('data-feedback-ignore'));
  const onMove = (event: Event): void => {
    if (passes(event) || (event as PointerEvent).pointerType === 'touch') return;
    const where = point(event);
    if (where) hover(where.x, where.y);
  };
  const onWheel = (event: Event): void => {
    if (passes(event)) return;
    const delta = (event as WheelEvent).deltaY;
    stop(event);
    if (delta < 0) move('up'); else if (delta > 0) move('down');
  };
  const onKey = (event: Event): void => {
    const key = event as KeyboardEvent;
    if (keys === 'outside-ignored' && inIgnored(event)) return;
    stop(event);
    if (event.type !== 'keydown') return;
    if (key.key === 'Escape') end({ kind: 'cancelled' });
    else if (key.key === 'ArrowUp') move('up');
    else if (key.key === 'ArrowDown') move('down');
    else if (key.key === 'Tab') tab(key.shiftKey);
    else if (key.key === 'Enter') pin({ add: key.shiftKey });
  };
  const onSubmit = (event: Event): void => { stop(event); };

  const listen = (type: string, handler: (event: Event) => void, passive = false): void => {
    const listenerOptions: AddEventListenerOptions = { capture: true, passive };
    view.addEventListener(type, handler, listenerOptions);
    removers.push(() => view.removeEventListener(type, handler, listenerOptions));
  };
  const listenAll = (): void => {
    for (const type of POINTER_EVENTS) listen(type, onPointer);
    for (const type of ['pointermove', 'mousemove']) listen(type, onMove, true);
    for (const type of KEY_EVENTS) listen(type, onKey);
    if (wheel) listen('wheel', onWheel);
    listen('submit', onSubmit);
  };

  const suspend = (on: boolean): void => {
    if (mode !== 'picking' || on === suspended) return;
    suspended = on;
    if (on) { for (const remove of removers.splice(0)) remove(); current = undefined; refusal = undefined; trail = []; }
    else listenAll();
    changed();
  };

  const start = (): Promise<PickerResult> => {
    if (mode === 'picking') return new Promise(resolve => { const previous = settle; settle = result => { previous?.(result); resolve(result); }; });
    mode = 'picking';
    pins = [];
    current = undefined;
    refusal = undefined;
    touch = false;
    suspended = false;
    trail = [];
    focus = document.activeElement;
    listenAll();
    const promise = new Promise<PickerResult>(resolve => { settle = resolve; });
    changed();
    return promise;
  };

  return {
    start,
    cancel: () => end({ kind: 'cancelled' }),
    finish,
    parent: () => move('up'),
    child: () => move('down'),
    pin,
    select,
    state,
    overlay,
    highlight: (element, note) => overlay.highlight(element, note),
    suspend,
    dispose: () => {
      end({ kind: 'cancelled' });
      mode = 'idle';
      if (ownsOverlay) overlay.dispose(); else overlay.clear();
    },
  };
}

function isElement(target: EventTarget): target is Element {
  return typeof (target as Element).hasAttribute === 'function' && (target as Node).nodeType === 1;
}
