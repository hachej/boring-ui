'use client';

// Ported from spike/canvas-board. Native shapes are a disposable projection of board@1, never a saved tldraw store.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { HTMLContainer, Rectangle2d, ShapeUtil, T, createShapeId, renderPlaintextFromRichText, toRichText, useValue } from 'tldraw';
import type { Editor, TLBaseShape } from 'tldraw';
import { CanvasProjection } from '@hachej/boring-ui-kit/canvas-editor';
import type { TextBuffer } from '@hachej/boring-ui-kit/text-buffer';
import { HandIcon, MousePointer2Icon, StickyNoteIcon, MaximizeIcon, Undo2Icon, Redo2Icon, MessageSquarePlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MockupViewer } from '../mockup-viewer/mockup-viewer';
import { parseMaquette } from '../maquette-viewer/maquette';
import { MaquetteScreenView } from '../maquette-viewer/maquette-blocks';
import { defaultMaquetteLabels } from '../maquette-viewer/maquette-labels';
import { applyCanvasEdits, parseBoard, planBoard, serializeBoard } from './board';
import type { Board } from './board';
import type { BoardHostProps } from './board-props';

const FRAME = 'board-frame';
type FrameProps = { w: number; h: number; kind: string; src: string; screen: string; title: string; frameId: string };
type BoardFrame = TLBaseShape<typeof FRAME, FrameProps>;
declare module 'tldraw' { interface TLGlobalShapePropsMap { 'board-frame': FrameProps } }
interface BoardContext {
  readonly files: ReadonlyMap<string, string>;
  readonly comments: BoardHostProps['comments'];
  readonly path: string;
  readonly go: (frameId: string, screen: string) => void;
}
const Context = createContext<BoardContext>({ files: new Map(), comments: undefined, path: '', go: () => {} });
const frameId = (id: string) => createShapeId(`frame-${id}`);

function FrameContent({ shape, editor }: { readonly shape: BoardFrame; readonly editor: Editor }) {
  const board = useContext(Context);
  const editing = useValue('board frame editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id]);
  const { src, kind, screen, frameId: id, title } = shape.props;
  const text = board.files.get(src) ?? '';
  const parsed = useMemo(() => kind === 'maquette' ? parseMaquette(text) : undefined, [kind, text]);
  const shown = parsed?.kind === 'ok' ? parsed.maquette.screens.find(item => item.id === screen) : undefined;
  return <HTMLContainer className="flex flex-col" style={{ width: shape.props.w, height: shape.props.h }}>
    <div className="pointer-events-none absolute -top-8 left-0 whitespace-nowrap text-muted-foreground" data-testid="board-frame-title">{title}</div>
    <Card className="min-h-0 flex-1 overflow-hidden" data-testid="board-frame" data-frame={id}>
      <CardContent className="min-h-0 flex-1 overflow-hidden" style={{ pointerEvents: editing || board.comments?.active ? 'auto' : 'none' }}>
        {kind === 'html' ? <MockupViewer text={text} path={src} comments={board.comments} />
          : shown && parsed?.kind === 'ok' ? <MaquetteScreenView maquette={parsed.maquette} screen={shown} labels={defaultMaquetteLabels}
            links={{ go: target => board.go(id, target), hint: target => `Opens ${target}`,
              target: block => `board:${board.path}#frame=${id}&block=${block.id}`,
              pins: block => board.comments?.pins.filter(pin => pin.target === `board:${board.path}#frame=${id}&block=${block.id}`).map(pin => pin.number) ?? [] }}  /> : <p role="alert">Unreadable maquette {src}</p>}
      </CardContent>
    </Card>
  </HTMLContainer>;
}

class BoardFrameUtil extends ShapeUtil<BoardFrame> {
  static override type = FRAME;
  static override props = { w: T.number, h: T.number, kind: T.string, src: T.string, screen: T.string, title: T.string, frameId: T.string };
  override getDefaultProps(): FrameProps { return { w: 390, h: 780, kind: 'maquette', src: '', screen: '', title: '', frameId: '' }; }
  override canEdit() { return !this.editor.getIsReadonly(); }
  override canResize() { return false; }
  override canBind() { return true; }
  override hideRotateHandle() { return true; }
  override getGeometry(shape: BoardFrame) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }); }
  override component(shape: BoardFrame) { return <FrameContent shape={shape} editor={this.editor} />; }
  override getIndicatorPath(shape: BoardFrame) { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path; }
}
const shapeUtils = [BoardFrameUtil];

function project(editor: Editor, board: Board, files: ReadonlyMap<string, string>) {
  const plan = planBoard(board, files);
  const readOnly = editor.getIsReadonly();
  editor.updateInstanceState({ isReadonly: false });
  try { editor.store.mergeRemoteChanges(() => editor.run(() => {
    editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
    editor.createShapes<BoardFrame>(plan.frames.map(frame => ({ id: frameId(frame.id), type: FRAME, x: frame.x, y: frame.y,
      props: { w: frame.w, h: frame.h, kind: frame.kind, src: frame.src, screen: frame.screen, title: frame.title, frameId: frame.id } })));
    const at = new Map(plan.frames.map(frame => [frame.id, frame]));
    // Duplicate goto targets produce one arrow per pair.
    for (const arrow of new Map(plan.arrows.map(arrow => [arrow.id, arrow])).values()) {
      const id = createShapeId(`arrow-${arrow.id}`);
      const backward = (at.get(arrow.from)?.x ?? 0) > (at.get(arrow.to)?.x ?? 0);
      editor.createShape({ id, type: 'arrow', isLocked: true, props: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, bend: backward ? -260 : 0,
        richText: toRichText(arrow.label), dash: backward ? 'dashed' : 'solid' } });
      editor.createBindings(([['start', arrow.from], ['end', arrow.to]] as const).map(([terminal, frame]) => ({ type: 'arrow', fromId: id, toId: frameId(frame),
        props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } })));
    }
    editor.createShapes(plan.notes.map(note => ({ id: createShapeId(`note-${note.id}`), type: 'note', x: note.x, y: note.y, props: { richText: toRichText(note.text) } })));
  }, { history: 'ignore', ignoreShapeLock: true })); }
  finally { editor.updateInstanceState({ isReadonly: readOnly }); }
  return plan;
}

function capture(editor: Editor, board: Board): Board | undefined {
  const positions: Record<string, { x: number; y: number }> = {};
  const notes: { id: string; text: string }[] = [];
  for (const shape of editor.getCurrentPageShapes()) {
    if (editor.isShapeOfType<BoardFrame>(shape, FRAME)) positions[shape.props.frameId] = { x: shape.x, y: shape.y };
    if (editor.isShapeOfType(shape, 'note')) {
      const id = shape.id.startsWith('shape:note-') ? shape.id.slice('shape:note-'.length) : `note-${shape.id.slice(6)}`;
      positions[id] = { x: shape.x, y: shape.y };
      notes.push({ id, text: renderPlaintextFromRichText(editor, shape.props.richText) });
    }
  }
  const result = applyCanvasEdits(board, { positions, notes });
  return result.kind === 'ok' ? result.board : undefined;
}

export default function BoardCanvas({ buffer, files, assetUrls, licenseKey, onEditor, comments }: Omit<BoardHostProps, 'identity' | 'client'> & { readonly buffer: TextBuffer; readonly files: ReadonlyMap<string, string> }) {
  const state = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot, buffer.getSnapshot);
  const [phone, setPhone] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 639px), (pointer: coarse)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 639px), (pointer: coarse)');
    const changed = () => setPhone(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const editorRef = useRef<Editor | null>(null);
  const projected = useRef(state.text);
  const [editor, setEditor] = useState<Editor | null>(null);
  const blocked = state.readOnly || phone;
  const mode = useRef(blocked); mode.current = blocked;
  const [problem, setProblem] = useState<string>();
  const attach = useCallback((native: Editor) => {
    editorRef.current = native;
    const parsed = parseBoard(buffer.getSnapshot().text);
    if (parsed.kind !== 'ok') return;
    projected.current = buffer.getSnapshot().text;
    const plan = project(native, parsed.board, files);
    native.updateInstanceState({ isReadonly: mode.current });
    native.setCurrentTool(mode.current ? 'hand' : 'select');
    const fit = () => {
      native.updateViewportScreenBounds(native.getContainer());
      const first = plan.frames[0] && native.getShapePageBounds(frameId(plan.frames[0].id));
      if (mode.current && first) native.zoomToBounds(first, { animation: { duration: 0 }, inset: 24 });
      else native.zoomToFit({ animation: { duration: 0 } });
    };
    fit();
    const timer = setTimeout(fit, 400);
    // Frame identity/content and goto arrows come only from board@1, never native delete/paste/rotate operations.
    const stopDelete = native.sideEffects.registerBeforeDeleteHandler('shape', (shape, source) => { if (source === 'user' && (shape.type === FRAME || shape.type === 'arrow')) return false; });
    const stopUpdate = native.sideEffects.registerBeforeChangeHandler('shape', (previous, next, source) => source === 'user' && previous.type === FRAME ? { ...previous, x: next.x, y: next.y } : next);
    const stop = native.store.listen(() => {
      if (mode.current) return;
      const current = parseBoard(buffer.getSnapshot().text);
      if (current.kind !== 'ok') return;
      const next = capture(native, current.board);
      if (!next) { setProblem('Finish the note before saving.'); return; }
      setProblem(undefined);
      projected.current = serializeBoard(next);
      buffer.edit(projected.current);
    }, { source: 'user', scope: 'document' });
    setEditor(native); onEditor?.(native);
    return () => { clearTimeout(timer); stop(); stopDelete(); stopUpdate(); editorRef.current = null; setEditor(null); onEditor?.(null); };
  }, [buffer, files, onEditor]);
  useEffect(() => {
    if (!editor) return;
    editor.updateInstanceState({ isReadonly: blocked });
    if (blocked) editor.setCurrentTool('hand');
  }, [editor, blocked]);
  useEffect(() => {
    if (!editor || state.text === projected.current) return;
    const parsed = parseBoard(state.text);
    if (parsed.kind === 'ok') { project(editor, parsed.board, files); projected.current = state.text; }
  }, [editor, state.text, files]);
  useEffect(() => {
    if (blocked || problem || !state.dirty || state.remote || state.save.kind === 'pending' || state.save.kind === 'settled' && state.save.result.kind !== 'saved') return;
    const timer = setTimeout(() => { void buffer.flush(buffer.selection()); }, 600);
    return () => clearTimeout(timer);
  }, [buffer, state, blocked, problem]);
  const context = useMemo<BoardContext>(() => ({ files, comments, path: state.base.target.resource.path, go: (id, screen) => {
    const native = editorRef.current;
    const target = native?.getShape(frameId(`${id.split('/')[0]}/${screen}`));
    const bounds = target && native?.getShapePageBounds(target);
    if (native && bounds) native.zoomToBounds(bounds, { animation: { duration: 200 }, inset: 24 });
  } }), [files, comments, state.base.target.resource.path]);
  return <Context.Provider value={context}><div data-testid="board" data-phone={phone} className="relative min-h-0 flex-1 overscroll-contain" style={{ touchAction: 'none' }}>
    <CanvasProjection assetUrls={assetUrls} licenseKey={licenseKey} hideUi shapeUtils={shapeUtils} onMount={attach} />
    {editor && <BoardTools editor={editor} blocked={blocked} comments={comments} />}
    {problem && <p role="alert" className="absolute bottom-2 left-2 text-muted-foreground">{problem}</p>}
  </div></Context.Provider>;
}

function BoardTools({ editor, blocked, comments }: { readonly editor: Editor; readonly blocked: boolean; readonly comments: BoardHostProps['comments'] }) {
  const native = useValue('board toolbar', () => ({ undo: editor.getCanUndo(), redo: editor.getCanRedo() }), [editor]);
  const tools = [
    ...(!blocked ? [{ label: 'Select frames', icon: MousePointer2Icon, action: () => editor.setCurrentTool('select') }, { label: 'Pan board', icon: HandIcon, action: () => editor.setCurrentTool('hand') },
      { label: 'Add note', icon: StickyNoteIcon, action: () => editor.setCurrentTool('note') }, { label: 'Undo', icon: Undo2Icon, action: () => editor.undo(), disabled: !native.undo },
      { label: 'Redo', icon: Redo2Icon, action: () => editor.redo(), disabled: !native.redo }] : []),
    { label: 'Fit board', icon: MaximizeIcon, action: () => editor.zoomToFit() },
    ...(comments ? [{ label: 'Comment on board', icon: MessageSquarePlusIcon, action: comments.point }] : []),
  ];
  return <nav aria-label="Board tools" data-feedback-ignore="" className="absolute top-2 left-2 z-[300] flex flex-wrap gap-1">
    {tools.map(tool => <Tooltip key={tool.label}><TooltipTrigger render={<Button size="icon" aria-label={tool.label} disabled={'disabled' in tool && tool.disabled} onClick={tool.action} />}><tool.icon aria-hidden="true" /></TooltipTrigger><TooltipContent>{tool.label}</TooltipContent></Tooltip>)}
  </nav>;
}
