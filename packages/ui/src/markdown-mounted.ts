import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { PresentationCommand, PresentationResult, ViewerTarget } from './contracts.js';
import type { MarkdownController } from './markdown.js';
import type { SaveSelection } from './resources.js';
import { freeze, sameBase } from './text-buffer.js';
import { randomUUID } from '@hachej/boring-files/platform';

export type MarkdownMountedSubject = SaveSelection['target']['subject'] & {
  readonly mountId: string;
  readonly projectionId: string;
  readonly mode: 'rich' | 'source';
};
export type MarkdownMountedSelection = { readonly kind: 'rich'; readonly anchor: number; readonly head: number }
  | { readonly kind: 'source'; readonly start: number; readonly end: number; readonly direction: 'forward' | 'backward' | 'none' };
export interface MarkdownMountedInspection {
  readonly selection: SaveSelection;
  readonly dirty: boolean;
  readonly headings: readonly { readonly index: number; readonly level: number; readonly text: string }[];
  readonly currentSelection: MarkdownMountedSelection;
  readonly text: string;
}
export interface MarkdownMountedTools {
  readonly getTarget: () => ViewerTarget<MarkdownMountedSubject> | null;
  readonly inspect: PresentationCommand<{ readonly expiresAt: number }, MarkdownMountedInspection, MarkdownMountedSubject>;
  readonly select: PresentationCommand<{ readonly expiresAt: number; readonly selection: MarkdownMountedSelection }, void, MarkdownMountedSubject>;
  readonly revealHeading: PresentationCommand<{ readonly expiresAt: number; readonly index: number }, void, MarkdownMountedSubject>;
}

type MountedView = { readonly kind: 'rich'; readonly editor: Editor; readonly projectedText: () => string | null }
  | { readonly kind: 'source'; readonly element: () => HTMLTextAreaElement | null };
type Refusal = Extract<PresentationResult<never>, { readonly kind: 'stale' | 'conflict' | 'denied' | 'unavailable' }>;
const expirySchema = { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER };
const positionSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
function expiry(value: unknown): { expiresAt: number } {
  if (!value || typeof value !== 'object' || !('expiresAt' in value) || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)) throw new TypeError('Command expiry is required');
  return { expiresAt: value.expiresAt };
}
function selectionInput(value: unknown): { expiresAt: number; selection: MarkdownMountedSelection } {
  const deadline = expiry(value);
  if (!value || typeof value !== 'object' || !('selection' in value) || !value.selection || typeof value.selection !== 'object') throw new TypeError('Selection is required');
  const selected = value.selection;
  if ('kind' in selected && selected.kind === 'rich' && 'anchor' in selected && 'head' in selected
    && typeof selected.anchor === 'number' && Number.isSafeInteger(selected.anchor) && selected.anchor >= 0
    && typeof selected.head === 'number' && Number.isSafeInteger(selected.head) && selected.head >= 0) {
    return { ...deadline, selection: { kind: 'rich', anchor: selected.anchor, head: selected.head } };
  }
  if ('kind' in selected && selected.kind === 'source' && 'start' in selected && 'end' in selected && 'direction' in selected
    && typeof selected.start === 'number' && Number.isSafeInteger(selected.start) && selected.start >= 0
    && typeof selected.end === 'number' && Number.isSafeInteger(selected.end) && selected.end >= selected.start
    && (selected.direction === 'forward' || selected.direction === 'backward' || selected.direction === 'none')) {
    return { ...deadline, selection: { kind: 'source', start: selected.start, end: selected.end, direction: selected.direction } };
  }
  throw new TypeError('Expected a rich document selection or source UTF-16 selection');
}
function headingInput(value: unknown): { expiresAt: number; index: number } {
  const deadline = expiry(value);
  if (!value || typeof value !== 'object' || !('index' in value) || typeof value.index !== 'number' || !Number.isSafeInteger(value.index) || value.index < 0) throw new TypeError('Heading index must be a nonnegative integer');
  return { ...deadline, index: value.index };
}

export function createMountedMarkdownTools({ controller, current, view }: {
  readonly controller: MarkdownController;
  readonly current: () => boolean;
  readonly view: MountedView;
}) {
  const mountId = randomUUID();
  let alive = false, projectionId = randomUUID();
  let document: Editor['state']['doc'] | undefined;
  const pending = new Set<(result: PresentationResult<void, MarkdownMountedSubject>) => void>();
  const element = () => {
    if (view.kind === 'source') return view.element();
    if (view.editor.isDestroyed) return null;
    try { return view.editor.view.dom; } catch { return null; }
  };
  const getTarget = (): ViewerTarget<MarkdownMountedSubject> | null => {
    if (!alive || !current() || controller.getSnapshot().lifecycle !== 'active' || !element()?.isConnected) return null;
    const state = controller.getSnapshot();
    if (view.kind === 'source') {
      if (view.element()?.value !== state.text) return null;
    } else {
      if (view.editor.isDestroyed || view.projectedText() !== state.text) return null;
      if (document !== view.editor.state.doc) { document = view.editor.state.doc; projectionId = randomUUID(); }
    }
    const selected = controller.actions.selection().target;
    return freeze({ ...selected, subject: { ...selected.subject, mountId, projectionId, mode: view.kind } });
  };
  const check = (target: ViewerTarget<MarkdownMountedSubject>, expiresAt: number, signal?: AbortSignal): Refusal | null => {
    if (!alive || !current() || controller.getSnapshot().lifecycle !== 'active' || !element()?.isConnected) return { kind: 'unavailable', reason: 'Mounted editor is unavailable' };
    if (signal?.aborted) return { kind: 'denied', reason: 'Command was cancelled' };
    if (expiresAt <= Date.now()) return { kind: 'stale', reason: 'Command expired' };
    const selected = getTarget();
    if (!selected) return { kind: 'stale', reason: 'Mounted editor has not projected the current buffer' };
    if (selected.instanceId !== target.instanceId || selected.epoch !== target.epoch
      || selected.subject.mountId !== target.subject.mountId || selected.subject.projectionId !== target.subject.projectionId
      || selected.subject.mode !== target.subject.mode || selected.subject.scopeId !== target.subject.scopeId
      || selected.subject.bufferVersion !== target.subject.bufferVersion || !sameBase(selected.subject.base, target.subject.base)) {
      return { kind: 'stale', reason: 'Mounted command target changed' };
    }
    return null;
  };
  const headings = () => {
    const values: { index: number; level: number; text: string; position: number }[] = [];
    if (view.kind === 'rich') view.editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'heading') values.push({ index: values.length, level: Number(node.attrs['level']), text: node.textContent, position });
    });
    return values;
  };
  const applySelection = (target: ViewerTarget<MarkdownMountedSubject>, expiresAt: number, selected: MarkdownMountedSelection, signal?: AbortSignal): PresentationResult<void, MarkdownMountedSubject> => {
    const refused = check(target, expiresAt, signal);
    if (refused) return refused;
    if (selected.kind !== view.kind) return { kind: 'denied', reason: 'Selection coordinates belong to another editor mode' };
    if (view.kind === 'source' && selected.kind === 'source') {
      const input = view.element();
      if (!input) return { kind: 'unavailable', reason: 'Source editor is unavailable' };
      if (selected.end > input.value.length) return { kind: 'denied', reason: 'Selection is outside the source buffer' };
      input.focus({ preventScroll: true });
      const changed = check(target, expiresAt, signal);
      if (changed) return changed;
      input.setSelectionRange(selected.start, selected.end, selected.direction);
      const after = check(target, expiresAt, signal);
      if (after) return after;
      const root = input.getRootNode();
      if (!('activeElement' in root) || root.activeElement !== input || input.selectionStart !== selected.start || input.selectionEnd !== selected.end
        || selected.start !== selected.end && input.selectionDirection !== selected.direction) return { kind: 'unavailable', reason: 'Source selection was not applied' };
    } else if (view.kind === 'rich' && selected.kind === 'rich') {
      const editor = view.editor, doc = editor.state.doc;
      if (selected.anchor > doc.content.size || selected.head > doc.content.size
        || !doc.resolve(selected.anchor).parent.inlineContent || !doc.resolve(selected.head).parent.inlineContent) return { kind: 'denied', reason: 'Selection must address document text' };
      editor.view.dom.focus({ preventScroll: true });
      const moved = check(target, expiresAt, signal);
      if (moved) return moved;
      const domSelection = editor.view.dom.ownerDocument.getSelection();
      if (!domSelection) return { kind: 'unavailable', reason: 'Browser selection is unavailable' };
      const anchor = editor.view.domAtPos(selected.anchor);
      domSelection.collapse(anchor.node, anchor.offset);
      const selectedDom = check(target, expiresAt, signal);
      if (selectedDom) return selectedDom;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, selected.anchor, selected.head)));
      const changed = check(target, expiresAt, signal);
      if (changed) return changed;
      editor.view.focus();
      const focused = check(target, expiresAt, signal);
      if (focused) return focused;
      editor.view.dispatch(editor.state.tr.scrollIntoView());
      const after = check(target, expiresAt, signal);
      if (after) return after;
      if (!editor.view.hasFocus() || editor.state.selection.anchor !== selected.anchor || editor.state.selection.head !== selected.head
        || !domSelection.anchorNode || !domSelection.focusNode || !editor.view.dom.contains(domSelection.anchorNode) || !editor.view.dom.contains(domSelection.focusNode)
        || editor.view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset) !== selected.anchor
        || editor.view.posAtDOM(domSelection.focusNode, domSelection.focusOffset) !== selected.head) return { kind: 'unavailable', reason: 'Rich selection was not applied' };
    }
    return { kind: 'applied', value: undefined };
  };
  const schedule = (target: ViewerTarget<MarkdownMountedSubject>, expiresAt: number, selected: MarkdownMountedSelection, signal?: AbortSignal): Promise<PresentationResult<void, MarkdownMountedSubject>> => {
    const refused = check(target, expiresAt, signal);
    if (refused) return Promise.resolve(refused);
    const window = element()?.ownerDocument.defaultView;
    if (!window) return Promise.resolve({ kind: 'unavailable', reason: 'Editor window is unavailable' });
    return new Promise(resolve => {
      let frame = 0, timer: ReturnType<typeof setTimeout> | undefined, settled = false;
      const finish = (result: PresentationResult<void, MarkdownMountedSubject>) => {
        if (settled) return;
        settled = true; window.cancelAnimationFrame(frame); clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(finish); resolve(result);
      };
      const abort = () => finish({ kind: 'denied', reason: 'Command was cancelled' });
      const expire = () => {
        const left = expiresAt - Date.now();
        if (left <= 0) finish({ kind: 'stale', reason: 'Command expired' });
        else timer = setTimeout(expire, Math.min(left, 2147483647));
      };
      pending.add(finish); signal?.addEventListener('abort', abort, { once: true }); expire();
      if (settled) return;
      try {
        frame = window.requestAnimationFrame(() => {
          if (settled) return;
          try { finish(applySelection(target, expiresAt, selected, signal)); }
          catch { finish(check(target, expiresAt, signal) ?? { kind: 'unavailable', reason: 'Browser selection failed' }); }
        });
      } catch { finish({ kind: 'unavailable', reason: 'Editor frame is unavailable' }); }
      if (signal?.aborted) abort();
    });
  };
  const tools: MarkdownMountedTools = {
    getTarget,
    inspect: {
      name: 'inspect_mounted_markdown',
      input: { jsonSchema: { type: 'object', properties: { expiresAt: expirySchema }, required: ['expiresAt'] }, parse: expiry },
      invoke: async (target, input, signal) => {
        const captured = structuredClone(target), { expiresAt } = expiry(input), refused = check(captured, expiresAt, signal);
        if (refused) return refused;
        let currentSelection: MarkdownMountedSelection, text: string;
        if (view.kind === 'source') {
          const input = view.element();
          if (!input) return { kind: 'unavailable', reason: 'Source editor is unavailable' };
          currentSelection = { kind: 'source', start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection };
          text = input.value.slice(input.selectionStart, input.selectionEnd);
        } else {
          const selected = view.editor.state.selection;
          currentSelection = { kind: 'rich', anchor: selected.anchor, head: selected.head };
          text = view.editor.state.doc.textBetween(selected.from, selected.to, '\n');
        }
        return { kind: 'applied', value: freeze({ selection: controller.actions.selection(), dirty: controller.getSnapshot().dirty, headings: headings().map(({ index, level, text }) => ({ index, level, text })), currentSelection, text }) };
      },
    },
    select: {
      name: 'select_mounted_markdown', input: { jsonSchema: { type: 'object', properties: { expiresAt: expirySchema, selection: { oneOf: [
        { type: 'object', properties: { kind: { const: 'rich' }, anchor: positionSchema, head: positionSchema }, required: ['kind', 'anchor', 'head'] },
        { type: 'object', properties: { kind: { const: 'source' }, start: positionSchema, end: positionSchema, direction: { enum: ['forward', 'backward', 'none'] } }, required: ['kind', 'start', 'end', 'direction'] },
      ] } }, required: ['expiresAt', 'selection'] }, parse: selectionInput },
      invoke: async (target, input, signal) => { const captured = structuredClone(target), parsed = selectionInput(input); return schedule(captured, parsed.expiresAt, parsed.selection, signal); },
    },
    revealHeading: {
      name: 'reveal_markdown_heading', input: { jsonSchema: { type: 'object', properties: { expiresAt: expirySchema, index: positionSchema }, required: ['expiresAt', 'index'] }, parse: headingInput },
      invoke: async (target, input, signal) => {
        const captured = structuredClone(target), parsed = headingInput(input), refused = check(captured, parsed.expiresAt, signal);
        if (refused) return refused;
        if (view.kind !== 'rich') return { kind: 'unavailable', reason: 'Heading navigation requires the rich editor' };
        const heading = headings()[parsed.index];
        if (!heading) return { kind: 'unavailable', reason: 'Heading is not present' };
        return schedule(captured, parsed.expiresAt, { kind: 'rich', anchor: heading.position + 1, head: heading.position + 1 }, signal);
      },
    },
  };
  return { tools, activate: () => { alive = true; }, dispose: () => {
    alive = false;
    for (const finish of [...pending]) finish({ kind: 'unavailable', reason: 'Mounted editor was detached' });
  } };
}
