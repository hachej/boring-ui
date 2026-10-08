// The picker overlay (FEEDBACK.md, "Pointing at elements: the picker"). One host element marked `data-feedback-overlay`, so every
// snapshot and the picker skip it, with its own shadow root. The layer never takes pointer events and changes no layout, style or event
// of the page; only the touch toolbar inside it is interactive. Text is set with `textContent` only.
import { FEEDBACK_OVERLAY_ATTRIBUTE } from '../privacy/policy.js';

/** How a box is drawn: the element under the pointer, a pinned element, a revealed element, or a numbered candidate to choose from. */
export type OverlayTone = 'hover' | 'pinned' | 'reveal' | 'candidate';

export interface OverlayBox {
  readonly element: Element;
  /** Label text. The picker builds it from the privacy policy only (`pickerLabel`). */
  readonly label: string;
  readonly tone: OverlayTone;
}

/** The touch toolbar: a tap selects, these buttons replace the keys. Absent actions are not shown. */
export interface OverlayToolbar {
  readonly parent: () => void;
  readonly child: () => void;
  readonly pin: () => void;
  readonly cancel: () => void;
  /** Shown when several elements are pinned. */
  readonly done?: () => void;
}

export interface PickerOverlay {
  /** The host element (light DOM, outside the application root). */
  readonly host: HTMLElement;
  readonly draw: (boxes: readonly OverlayBox[]) => void;
  /** Draws one revealed element with a note (Show). */
  readonly highlight: (element: Element, note?: string) => void;
  readonly toolbar: (actions: OverlayToolbar | undefined) => void;
  readonly clear: () => void;
  /** What is drawn now, for tests and journeys: each box's label and tone. */
  readonly drawn: () => readonly { readonly label: string; readonly tone: OverlayTone }[];
  readonly dispose: () => void;
}

export interface OverlayOptions {
  readonly document: Document;
  /** Extra CSS for the shadow root (the registry's `PickerOverlay` styles). The parts are `box`, `label` and `toolbar`. */
  readonly styles?: string;
  /** Where the host is appended; defaults to `document.body`. Never inside the application root. */
  readonly mount?: Element;
}

const BASE_STYLES = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; contain: layout style; }
.layer { position: absolute; inset: 0; pointer-events: none; }
.box { position: fixed; box-sizing: border-box; border: 2px solid var(--boring-feedback-accent, #2563eb); border-radius: 3px;
  background: color-mix(in srgb, var(--boring-feedback-accent, #2563eb) 12%, transparent); pointer-events: none; }
.box[data-tone="pinned"] { border-style: solid; border-width: 3px; }
.box[data-tone="reveal"] { border-color: var(--boring-feedback-reveal, #d97706); background: color-mix(in srgb, var(--boring-feedback-reveal, #d97706) 14%, transparent); }
.box[data-tone="candidate"] { border-style: dashed; }
.label { position: fixed; max-width: min(28rem, 90vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px;
  border-radius: 4px; background: var(--boring-feedback-label-background, #111827); color: var(--boring-feedback-label-foreground, #f9fafb);
  font: 500 12px/1.5 ui-sans-serif, system-ui, sans-serif; pointer-events: none; }
.label[data-tone="candidate"] { min-width: 1.5em; text-align: center; font-weight: 700; }
.toolbar { position: fixed; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 6px; padding: 6px;
  border-radius: 12px; background: var(--boring-feedback-label-background, #111827); pointer-events: auto; }
.toolbar[hidden] { display: none; }
.toolbar button { min-width: 44px; min-height: 44px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent;
  color: var(--boring-feedback-label-foreground, #f9fafb); font: 600 14px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.toolbar button:focus-visible { outline: 2px solid var(--boring-feedback-accent, #2563eb); }
`;

const LABEL_HEIGHT = 22;

/** Creates the overlay host and its shadow root. Nothing is drawn until `draw` or `highlight`. */
export function createOverlay({ document, styles, mount }: OverlayOptions): PickerOverlay {
  const host = document.createElement('div');
  host.setAttribute(FEEDBACK_OVERLAY_ATTRIBUTE, '');
  host.setAttribute('data-boring', 'feedback');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BASE_STYLES + (styles ?? '');
  const layer = document.createElement('div');
  layer.className = 'layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('part', 'layer');
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Pick an element');
  bar.setAttribute('part', 'toolbar');
  bar.hidden = true;
  shadow.append(style, layer, bar);
  (mount ?? document.body).append(host);

  const view = document.defaultView;
  let boxes: readonly OverlayBox[] = [];
  let frame: number | undefined;
  let following = false;

  const render = (): void => {
    frame = undefined;
    layer.replaceChildren();
    const height = view?.innerHeight ?? 0;
    for (const item of boxes) {
      if (!item.element.isConnected) continue;
      const rect = item.element.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'box';
      box.dataset['tone'] = item.tone;
      box.setAttribute('part', `box box-${item.tone}`);
      box.style.cssText = `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px`;
      const label = document.createElement('div');
      label.className = 'label';
      label.dataset['tone'] = item.tone;
      label.setAttribute('part', `label label-${item.tone}`);
      label.textContent = item.label;
      const above = rect.top - LABEL_HEIGHT - 2;
      const top = above >= 0 ? above : Math.min(rect.bottom + 2, Math.max(0, height - LABEL_HEIGHT));
      label.style.cssText = `top:${top}px;left:${Math.max(0, rect.left)}px`;
      layer.append(box, label);
    }
  };
  const schedule = (): void => {
    if (frame !== undefined) return;
    if (view && typeof view.requestAnimationFrame === 'function') frame = view.requestAnimationFrame(render);
    else render();
  };
  const follow = (on: boolean): void => {
    if (!view || on === following) return;
    following = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    view[method]('scroll', schedule, { capture: true });
    view[method]('resize', schedule);
  };
  const draw = (next: readonly OverlayBox[]): void => {
    boxes = Object.freeze([...next]);
    follow(boxes.length > 0);
    if (frame !== undefined && view) { view.cancelAnimationFrame(frame); frame = undefined; }
    render();
  };

  const toolbar = (actions: OverlayToolbar | undefined): void => {
    bar.replaceChildren();
    bar.hidden = actions === undefined;
    if (!actions) return;
    const entries: readonly (readonly [string, string, (() => void) | undefined])[] = [
      ['parent', 'Parent', actions.parent], ['child', 'Child', actions.child], ['pin', 'Pin', actions.pin], ['done', 'Done', actions.done], ['cancel', 'Cancel', actions.cancel],
    ];
    for (const [name, text, run] of entries) {
      if (!run) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset['action'] = name;
      button.textContent = text;
      button.addEventListener('click', event => { event.preventDefault(); run(); });
      bar.append(button);
    }
  };

  return {
    host,
    draw,
    highlight: (element, note) => draw([{ element, label: note ?? 'Here', tone: 'reveal' }]),
    toolbar,
    clear: () => draw([]),
    drawn: () => boxes.filter(item => item.element.isConnected).map(({ label, tone }) => ({ label, tone })),
    dispose: () => { draw([]); toolbar(undefined); host.remove(); },
  };
}
