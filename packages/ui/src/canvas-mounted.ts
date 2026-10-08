import type { BoxLike, Editor, TLCamera, TLPageId, TLShape, TLShapeId } from '@tldraw/editor';
import { randomUUID } from '@hachej/boring-files/platform';
import type { PresentationCommand, PresentationResult, ViewerTarget } from './contracts.js';
import type { CanvasController, CanvasProposalInput } from './canvas.js';
import type { SaveSelection } from './resources.js';
import { freeze, sameBase } from './text-buffer.js';

export type CanvasMountedSubject = SaveSelection['target']['subject'] & { readonly mountId: string; readonly pageId: TLPageId };
export interface CanvasMountedInspection {
  readonly selection: SaveSelection;
  readonly dirty: boolean;
  readonly pageId: TLPageId;
  readonly shapes: readonly TLShape[];
  readonly selectedShapeIds: readonly TLShapeId[];
  readonly camera: TLCamera;
  readonly viewport: Readonly<BoxLike>;
}
export interface CanvasMountedTools {
  readonly getTarget: () => ViewerTarget<CanvasMountedSubject> | null;
  readonly inspect: PresentationCommand<{ readonly expiresAt: number }, CanvasMountedInspection, CanvasMountedSubject>;
  readonly select: PresentationCommand<{ readonly expiresAt: number; readonly shapeIds: readonly string[] }, void, CanvasMountedSubject>;
  readonly frame: PresentationCommand<{ readonly expiresAt: number; readonly shapeIds: readonly string[] }, void, CanvasMountedSubject>;
  readonly propose: PresentationCommand<CanvasProposalInput, void, CanvasMountedSubject>;
}
type Refusal = Extract<PresentationResult<never>, { readonly kind: 'stale' | 'conflict' | 'denied' | 'unavailable' }>;
const expirySchema = { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER };
function expiry(value: unknown): { expiresAt: number } {
  if (!value || typeof value !== 'object' || !('expiresAt' in value) || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)) throw new TypeError('Command expiry is required');
  return { expiresAt: value.expiresAt };
}
function shapesInput(value: unknown): { expiresAt: number; shapeIds: string[] } {
  const deadline = expiry(value);
  if (!value || typeof value !== 'object' || !('shapeIds' in value) || !Array.isArray(value.shapeIds)) throw new TypeError('Shape IDs are required');
  const shapeIds: string[] = [];
  for (const id of value.shapeIds) {
    if (typeof id !== 'string' || !id) throw new TypeError('Shape IDs must be nonempty strings');
    if (!shapeIds.includes(id)) shapeIds.push(id);
  }
  return { ...deadline, shapeIds };
}
const shapesSchema = { type: 'object', properties: { expiresAt: expirySchema, shapeIds: { type: 'array', items: { type: 'string', minLength: 1 } } }, required: ['expiresAt', 'shapeIds'] };
function finiteBounds(box: BoxLike): boolean {
  return [box.x, box.y, box.w, box.h, box.x + box.w, box.y + box.h].every(Number.isFinite) && box.w >= 0 && box.h >= 0;
}
export function createMountedCanvasTools({ controller, editor }: { readonly controller: CanvasController; readonly editor: Editor }) {
  const mountId = randomUUID();
  let alive = false;
  const available = () => alive && !editor.isDisposed && editor.store === controller.store
    && editor.getContainer().isConnected && controller.getSnapshot().lifecycle === 'active' && !controller.getSnapshot().problem;
  const viewportReady = () => {
    const screen = editor.getContainer().getBoundingClientRect();
    const viewport = editor.getViewportScreenBounds();
    return [screen.x, screen.y, screen.width, screen.height].every(Number.isFinite) && screen.width > 0 && screen.height > 0
      && finiteBounds(viewport) && Math.abs(viewport.x - screen.x) < 1e-6 && Math.abs(viewport.y - screen.y) < 1e-6
      && Math.abs(viewport.w - screen.width) < 1e-6 && Math.abs(viewport.h - screen.height) < 1e-6;
  };
  const getTarget = (): ViewerTarget<CanvasMountedSubject> | null => {
    if (!available()) return null;
    const pageId = editor.getCurrentPageId();
    let selected: SaveSelection['target'];
    try { selected = controller.actions.selection().target; }
    catch (error) {
      if (!available()) return null;
      throw error;
    }
    if (!available() || editor.getCurrentPageId() !== pageId) return null;
    return freeze({ ...selected, subject: { ...selected.subject, mountId, pageId } });
  };
  const check = (target: ViewerTarget<CanvasMountedSubject>, expiresAt: number, signal?: AbortSignal): Refusal | null => {
    if (!available()) return { kind: 'unavailable', reason: 'Mounted canvas is unavailable' };
    if (signal?.aborted) return { kind: 'denied', reason: 'Command was cancelled' };
    if (expiresAt <= Date.now()) return { kind: 'stale', reason: 'Command expired' };
    const selected = getTarget();
    if (!selected) return { kind: 'unavailable', reason: 'Mounted canvas changed during capture' };
    if (selected.instanceId !== target.instanceId || selected.epoch !== target.epoch
      || selected.subject.mountId !== target.subject.mountId || selected.subject.pageId !== target.subject.pageId
      || selected.subject.scopeId !== target.subject.scopeId || selected.subject.bufferVersion !== target.subject.bufferVersion
      || !sameBase(selected.subject.base, target.subject.base)) return { kind: 'stale', reason: 'Mounted command target changed' };
    if (!available()) return { kind: 'unavailable', reason: 'Mounted canvas is unavailable' };
    if (signal?.aborted) return { kind: 'denied', reason: 'Command was cancelled' };
    if (expiresAt <= Date.now()) return { kind: 'stale', reason: 'Command expired' };
    return null;
  };
  const operate = async (target: ViewerTarget<CanvasMountedSubject>, input: unknown, frame: boolean, signal?: AbortSignal): Promise<PresentationResult<void, CanvasMountedSubject>> => {
    const captured = structuredClone(target), parsed = shapesInput(input);
    const refused = check(captured, parsed.expiresAt, signal);
    if (refused) return refused;
    const shapes = editor.getCurrentPageShapes();
    const ids: TLShapeId[] = [];
    for (const requested of parsed.shapeIds) {
      const shape = shapes.find(shape => shape.id === requested);
      if (!shape) return { kind: 'denied', reason: 'Shape is not on the current page' };
      ids.push(shape.id);
    }
    if (frame) {
      if (!ids.length) return { kind: 'denied', reason: 'Framing requires at least one shape' };
      if (editor.getCameraOptions().isLocked) return { kind: 'denied', reason: 'Canvas camera is locked' };
      if (!viewportReady()) return { kind: 'unavailable', reason: 'Canvas viewport is unavailable or awaiting layout' };
      let bounds: BoxLike | undefined;
      for (const id of ids) {
        const box = editor.getShapePageBounds(id);
        if (!box || !finiteBounds(box)) return { kind: 'unavailable', reason: 'Shape bounds are unavailable' };
        if (!bounds) bounds = { x: box.x, y: box.y, w: box.w, h: box.h };
        else {
          const x = Math.min(bounds.x, box.x), y = Math.min(bounds.y, box.y);
          bounds = { x, y, w: Math.max(bounds.x + bounds.w, box.x + box.w) - x, h: Math.max(bounds.y + bounds.h, box.y + box.h) - y };
        }
      }
      if (!bounds || !finiteBounds(bounds)) return { kind: 'unavailable', reason: 'Shape bounds are unavailable' };
      const before = check(captured, parsed.expiresAt, signal);
      if (before) return before;
      editor.zoomToBounds(bounds, { immediate: true });
      const after = check(captured, parsed.expiresAt, signal);
      if (after) return after;
      if (!viewportReady()) return { kind: 'unavailable', reason: 'Canvas viewport changed during framing' };
      const actual = editor.getViewportPageBounds();
      if (!finiteBounds(actual) || actual.w <= 0 || actual.h <= 0 || actual.x > bounds.x + 1e-6 || actual.y > bounds.y + 1e-6
        || actual.x + actual.w < bounds.x + bounds.w - 1e-6 || actual.y + actual.h < bounds.y + bounds.h - 1e-6) return { kind: 'unavailable', reason: 'Camera constraints prevented framing' };
    } else {
      const before = check(captured, parsed.expiresAt, signal);
      if (before) return before;
      editor.setSelectedShapes(ids);
      const after = check(captured, parsed.expiresAt, signal);
      if (after) return after;
      const selected = editor.getSelectedShapeIds();
      if (selected.length !== ids.length || !ids.every(id => selected.includes(id))) return { kind: 'unavailable', reason: 'Shape selection was not applied' };
    }
    return { kind: 'applied', value: undefined };
  };
  const tools: CanvasMountedTools = {
    getTarget,
    inspect: {
      name: 'inspect_mounted_canvas', input: { jsonSchema: { type: 'object', properties: { expiresAt: expirySchema }, required: ['expiresAt'] }, parse: expiry },
      invoke: async (target, input, signal) => {
        const captured = structuredClone(target), parsed = expiry(input), refused = check(captured, parsed.expiresAt, signal);
        if (refused) return refused;
        const selection = controller.actions.selection();
        const viewport = editor.getViewportPageBounds();
        const value = freeze(structuredClone({ selection, dirty: controller.getSnapshot().dirty, pageId: editor.getCurrentPageId(), shapes: editor.getCurrentPageShapes(),
          selectedShapeIds: editor.getSelectedShapeIds(), camera: editor.getCamera(), viewport: { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h } }));
        return check(captured, parsed.expiresAt, signal) ?? { kind: 'applied', value };
      },
    },
    select: { name: 'select_mounted_canvas', input: { jsonSchema: shapesSchema, parse: shapesInput }, invoke: (target, input, signal) => operate(target, input, false, signal) },
    frame: { name: 'frame_mounted_canvas', input: { jsonSchema: shapesSchema, parse: shapesInput }, invoke: (target, input, signal) => operate(target, input, true, signal) },
    propose: {
      name: 'propose_mounted_canvas_edits', input: controller.tools.propose.input,
      invoke: async (target, input, signal) => {
        const captured = structuredClone(target), parsed = controller.tools.propose.input.parse(input);
        const refused = check(captured, parsed.expiresAt, signal);
        if (refused) return refused;
        if (controller.getSnapshot().readOnly || editor.getIsReadonly()) return { kind: 'denied', reason: 'Canvas is read-only' };
        const result = await controller.tools.propose.invoke(captured, parsed, signal);
        if (result.kind === 'proposed') {
          const lateRefusal = check(captured, parsed.expiresAt, signal)
            ?? (editor.getIsReadonly() ? { kind: 'denied' as const, reason: 'Canvas is read-only' } : null);
          if (lateRefusal) { controller.actions.reject(result.proposalId); return lateRefusal; }
        }
        return result.kind === 'proposed' ? { ...result, base: captured } : result;
      },
    },
  };
  return { tools, activate: () => { alive = true; }, dispose: () => { alive = false; } };
}
