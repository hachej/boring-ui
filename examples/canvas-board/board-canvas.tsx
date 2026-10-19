// The board in the artifact panel: a tldraw canvas projected from a `board@1` file. One custom shape, `board-frame`, draws either a
// maquette screen (the registry's real MaquetteScreenView, the app's shadcn components) or an HTML mock-up (the html viewer's sandbox).
// Arrows (goto links) and sticky notes are native tldraw shapes. Moves and notes are written back to the board file through the workspace
// provider (conditional publication on the revision the board was read at); tldraw's own store is never saved. Comment mode turns a tap
// on any element (in a maquette frame, or inside a sandboxed HTML frame through postMessage) into a feedback@1 report for the PM conversation.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HTMLContainer, Rectangle2d, ShapeUtil, T, Tldraw, createShapeId, toRichText, renderPlaintextFromRichText, getSnapshot, useEditor, useValue, defaultEditorAssetUrls, iconTypes, LANGUAGES, DEFAULT_EMBED_DEFINITIONS } from 'tldraw';
import type { Editor, TLShapeId } from 'tldraw';
import { randomUUID } from '@hachej/boring-files/platform';
import type { ResourceClient } from '@hachej/boring-files';
import { draftReport, feedbackText } from '@hachej/boring-feedback/format';
import { parseMaquette } from '../../registry/maquette-viewer/maquette';
import { MaquetteScreenView } from '../../registry/maquette-viewer/maquette-blocks';
import { defaultMaquetteLabels } from '../../registry/maquette-viewer/maquette-labels';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseBoard, planBoard, serializeBoard, withCanvasEdits } from './board';
import type { Board, PlannedFrame } from './board';
import { mockupDocument, readPick } from './mockup-frame';
import type { MockupCss, Pick } from './mockup-frame';

const FRAME = 'board-frame';

/** tldraw's fonts, icons, translations and embed icons from this origin (the host serves @tldraw/assets at `base`), never cdn.tldraw.com. */
export function selfHostedAssetUrls(base: string) {
  const local = (url: string) => url.replace(/^https:\/\/cdn\.tldraw\.com\/[^/]+/, base);
  return {
    fonts: Object.fromEntries(Object.entries(defaultEditorAssetUrls.fonts).map(([key, url]) => [key, local(String(url))])),
    icons: Object.fromEntries(iconTypes.map(name => [name, `${base}/icons/icon/0_merged.svg#${name}`])),
    translations: Object.fromEntries(LANGUAGES.map(({ locale }) => [locale, `${base}/translations/${locale}.json`])),
    embedIcons: Object.fromEntries(DEFAULT_EMBED_DEFINITIONS.map(({ type }) => [type, `${base}/embed-icons/${type}.png`])),
  };
}
declare module 'tldraw' { interface TLGlobalShapePropsMap { [FRAME]: { w: number; h: number; kind: string; src: string; screen: string; title: string; frameId: string } } }

/** What frames read while they draw: referenced files' text, the theme CSS, comment mode, and where picks go. */
interface BoardContext {
  readonly files: ReadonlyMap<string, string>;
  readonly css: MockupCss;
  readonly commenting: boolean;
  readonly frames: Map<string, HTMLIFrameElement>;
  readonly onPick: (frameId: string, pick: Pick) => void;
  readonly onGo: (frameId: string, screen: string) => void;
}
const Context = createContext<BoardContext | null>(null);

function MaquetteFrame({ frameId, src, screen }: { readonly frameId: string; readonly src: string; readonly screen: string }) {
  const board = useContext(Context)!;
  const parsed = useMemo(() => parseMaquette(board.files.get(src) ?? ''), [board.files, src]);
  if (parsed.kind !== 'ok') return <p className="p-4 text-sm text-destructive">Unreadable maquette {src}</p>;
  const shown = parsed.maquette.screens.find(item => item.id === screen) ?? parsed.maquette.screens[0]!;
  const pick = (event: React.MouseEvent) => {
    if (!board.commenting) return;
    event.preventDefault(); event.stopPropagation();
    const element = event.target as HTMLElement, box = element.getBoundingClientRect(), frame = event.currentTarget.getBoundingClientRect();
    const scale = frame.width / event.currentTarget.clientWidth || 1;
    const testId = element.closest('[data-testid]')?.getAttribute('data-testid') ?? element.tagName.toLowerCase();
    board.onPick(frameId, { selector: `[data-testid=${testId}]`, text: (element.innerText || element.textContent || '').trim().slice(0, 200),
      rect: { x: (box.x - frame.x) / scale, y: (box.y - frame.y) / scale, w: box.width / scale, h: box.height / scale } });
  };
  return <div className="size-full overflow-hidden bg-background text-foreground" onClickCapture={pick} data-testid="board-maquette-frame" data-frame={frameId}>
    <Card className="m-0 h-full rounded-none border-0 shadow-none"><CardContent>
      <MaquetteScreenView maquette={parsed.maquette} screen={shown} labels={defaultMaquetteLabels}
        links={{ go: target => board.onGo(frameId, target), hint: target => `Opens ${target}` }} />
    </CardContent></Card>
  </div>;
}

function HtmlFrame({ frameId, src, interactive }: { readonly frameId: string; readonly src: string; readonly interactive: boolean }) {
  const board = useContext(Context)!;
  const [doc, setDoc] = useState<string>();
  const ref = useRef<HTMLIFrameElement>(null);
  const html = board.files.get(src) ?? '';
  useEffect(() => { let live = true; void mockupDocument(html, board.css).then(text => { if (live) setDoc(text); }); return () => { live = false; }; }, [html, board.css]);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    board.frames.set(frameId, frame);
    return () => { if (board.frames.get(frameId) === frame) board.frames.delete(frameId); };
  }, [board.frames, frameId, doc]);
  useEffect(() => { ref.current?.contentWindow?.postMessage({ type: 'board:pick-mode', on: board.commenting }, '*'); }, [board.commenting, doc]);
  if (!doc) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  // The html viewer's sandbox exactly: scripts, nothing else; no same-origin, so the page cannot reach this page, its storage or cookies.
  return <iframe ref={ref} title={src} sandbox="allow-scripts" allow="" referrerPolicy="no-referrer" srcDoc={doc} data-testid="board-html-frame" data-frame={frameId}
    onLoad={event => event.currentTarget.contentWindow?.postMessage({ type: 'board:pick-mode', on: board.commenting }, '*')}
    className="size-full border-0 bg-background" style={{ pointerEvents: interactive || board.commenting ? 'auto' : 'none' }} />;
}

class BoardFrameUtil extends ShapeUtil<any> {
  static override type = FRAME;
  static override props = { w: T.number, h: T.number, kind: T.string, src: T.string, screen: T.string, title: T.string, frameId: T.string };
  getDefaultProps() { return { w: 390, h: 780, kind: 'maquette', src: '', screen: '', title: '', frameId: '' }; }
  override canEdit() { return true; }
  override canResize() { return false; }
  override hideRotateHandle() { return true; }
  getGeometry(shape: any) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }); }
  component(shape: any) {
    const editing = this.editor.getEditingShapeId() === shape.id;
    const { kind, src, screen, title, frameId } = shape.props;
    return <HTMLContainer style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all' }}>
      <div className="pointer-events-none absolute -top-8 left-0 text-[15px] font-medium text-muted-foreground whitespace-nowrap" data-testid="board-frame-title">{title}</div>
      <div className="size-full overflow-hidden rounded-xl border border-border bg-background shadow-md" style={{ pointerEvents: editing ? 'auto' : undefined }}>
        {kind === 'html' ? <HtmlFrame frameId={frameId} src={src} interactive={editing} /> : <CommentGate editing={editing}><MaquetteFrame frameId={frameId} src={src} screen={screen} /></CommentGate>}
      </div>
    </HTMLContainer>;
  }
  getIndicatorPath(shape: any) { const path = new Path2D(); path.roundRect(0, 0, shape.props.w, shape.props.h, 12); return path; }
}

/** A maquette frame takes the pointer only while edited (double-click) or in comment mode; otherwise the canvas gets it (select, move, pan). */
function CommentGate({ editing, children }: { readonly editing: boolean; readonly children: React.ReactNode }) {
  const board = useContext(Context)!;
  return <div className="size-full" style={{ pointerEvents: editing || board.commenting ? 'auto' : 'none' }}
    onPointerDownCapture={event => { if (board.commenting) event.stopPropagation(); }}>{children}</div>;
}

const frameShapeId = (id: string) => createShapeId(`frame-${id}`);
const arrowShapeId = (id: string) => createShapeId(`arrow-${id}`);
const noteShapeId = (id: string) => createShapeId(`note-${id}`);

/** Puts the planned frames, arrows and notes in the editor's (empty) store, outside undo history. */
function project(editor: Editor, board: Board, files: ReadonlyMap<string, string>) {
  const plan = planBoard(board, files);
  editor.run(() => {
    editor.createShapes(plan.frames.map((frame: PlannedFrame) => ({ id: frameShapeId(frame.id), type: FRAME, x: frame.x, y: frame.y,
      props: { w: frame.w, h: frame.h, kind: frame.kind, src: frame.src, screen: frame.screen, title: frame.title, frameId: frame.id } })));
    const at = new Map(plan.frames.map(frame => [frame.id, frame]));
    for (const arrow of plan.arrows) {
      const id = arrowShapeId(arrow.id);
      // Backward links (Back, "book another") arc below the row so they do not lie on top of the forward ones.
      const backward = (at.get(arrow.from)?.x ?? 0) > (at.get(arrow.to)?.x ?? 0);
      editor.createShape({ id, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, bend: backward ? -260 : 0, richText: toRichText(arrow.label), color: backward ? 'grey' : 'violet', size: 'm', dash: backward ? 'dashed' : 'solid' } });
      editor.createBindings(([['start', arrow.from], ['end', arrow.to]] as const).map(([terminal, frame]) => ({ type: 'arrow', fromId: id, toId: frameShapeId(frame),
        props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: 'none' } })));
    }
    editor.createShapes(plan.notes.map(note => ({ id: noteShapeId(note.id), type: 'note', x: note.x, y: note.y, props: { richText: toRichText(note.text), color: 'yellow' } })));
  }, { history: 'ignore' });
  // A phone starts on the first frame with the hand tool: a one-finger drag pans instead of moving frames (and publishing the move).
  if (matchMedia('(pointer: coarse)').matches && plan.frames[0]) {
    editor.setCurrentTool('hand');
    const first = editor.getShapePageBounds(frameShapeId(plan.frames[0].id))!;
    // After the sheet has its final size (the drawer animates in), so the whole first frame fits.
    setTimeout(() => { editor.updateViewportScreenBounds(editor.getContainer()); editor.zoomToBounds(first, { animation: { duration: 0 }, inset: 32 }); }, 400);
  } else editor.zoomToFit({ animation: { duration: 0 } });
}

/** The board as the canvas now has it: frame positions and the notes (people's new notes get an id here). */
function readEdits(editor: Editor, board: Board): Board {
  const positions: Record<string, { x: number; y: number }> = {}, notes: { id: string; text: string }[] = [];
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type === FRAME) positions[(shape.props as any).frameId] = { x: shape.x, y: shape.y };
    if (shape.type === 'note') {
      const id = String(shape.id).startsWith('shape:note-') ? String(shape.id).slice('shape:note-'.length) : `note-${String(shape.id).slice(6, 14)}`;
      positions[id] = { x: shape.x, y: shape.y };
      notes.push({ id, text: renderPlaintextFromRichText(editor, (shape.props as any).richText) });
    }
  }
  return withCanvasEdits(board, positions, notes);
}

export interface BoardPin { readonly id: string; readonly frameId: string; readonly selector: string; readonly text: string; readonly said: string; readonly report: string; readonly at: { x: number; y: number } }

export interface BoardCanvasProps {
  readonly path: string;
  readonly text: string;
  readonly revision: string | undefined;
  readonly client: ResourceClient;
  readonly css: MockupCss;
  /** Where the host serves @tldraw/assets. */
  readonly assetBase: string;
  readonly licenseKey?: string | undefined;
  readonly onPin: (pin: BoardPin) => void;
  /** Test hook: the mounted editor. */
  readonly onEditor?: (editor: Editor | null) => void;
}

const dirOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
const sha256 = async (text: string) => `sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;

export function BoardCanvas({ path, text, revision, client, css, assetBase, licenseKey, onPin, onEditor }: BoardCanvasProps) {
  const parsed = useMemo(() => parseBoard(text), [text]);
  const [files, setFiles] = useState<Map<string, string> | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [draft, setDraft] = useState<{ frameId: string; pick: Pick } | null>(null);
  const [pins, setPins] = useState<BoardPin[]>([]);
  const pinsRef = useRef<BoardPin[]>([]);
  // On a phone the board shows no tldraw chrome: viewing, panning and commenting are the jobs there; drawing stays on a wide screen.
  const [phone] = useState(() => matchMedia('(pointer: coarse)').matches);
  pinsRef.current = pins;
  const [save, setSave] = useState<'saved' | 'saving' | 'conflict' | 'failed'>('saved');
  const editorRef = useRef<Editor | null>(null);
  const base = useRef({ revision, text });
  const frames = useMemo(() => new Map<string, HTMLIFrameElement>(), []);
  const board = parsed.kind === 'ok' ? parsed.board : null;
  const assetUrls = useMemo(() => selfHostedAssetUrls(assetBase), [assetBase]);

  // The referenced files, read through the same resource client as the panel (latest published revision).
  useEffect(() => {
    if (!board) return;
    let live = true;
    const paths = [...new Set(board.items.flatMap(item => 'maquette' in item ? [item.maquette] : 'html' in item ? [item.html] : []))];
    void Promise.all(paths.map(async relative => {
      const result = await client.read({ target: { resource: { providerId: 'workspace', path: dirOf(path) + relative }, view: { kind: 'published' } }, revision: { kind: 'latest' } });
      return [relative, result.kind === 'available' ? new TextDecoder().decode(result.snapshot.bytes) : ''] as const;
    })).then(entries => { if (live) setFiles(new Map(entries)); });
    return () => { live = false; };
  }, [board, client, path]);

  // People's edits go back into the board file: debounced, conditional on the revision last read or written.
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const persist = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !board || !client.publish) return;
    const next = serializeBoard(readEdits(editor, board));
    if (next === base.current.text || !base.current.revision) return;
    setSave('saving');
    const target = { resource: { providerId: 'workspace', path }, view: { kind: 'published' as const }, revision: base.current.revision };
    void client.publish({ operationId: randomUUID(), atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target, bytes: new TextEncoder().encode(next), mediaType: 'application/json' }] })
      .then(result => {
        if (result.kind === 'committed') { base.current = { revision: result.receipt.changes[0].after!.revision, text: next }; setSave('saved'); }
        else setSave(result.kind === 'conflict' ? 'conflict' : 'failed');
      }).catch(() => setSave('failed'));
  }, [board, client, path]);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor; onEditor?.(editor);
    if (board && files) project(editor, board, files);
    const stop = editor.store.listen(() => { clearTimeout(timer.current); timer.current = setTimeout(persist, 600); }, { source: 'user', scope: 'document' });
    return () => { stop(); clearTimeout(timer.current); editorRef.current = null; onEditor?.(null); };
  }, [board, files, persist, onEditor]);

  // Picks from HTML frames: only messages whose source is one of this board's frames count, and their data is bounded.
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const frameId = [...frames.entries()].find(([, frame]) => frame.contentWindow === event.source)?.[0];
      const pick = frameId ? readPick(event.data) : null;
      if (frameId && pick) setDraft({ frameId, pick });
    };
    addEventListener('message', listen);
    return () => removeEventListener('message', listen);
  }, [frames]);

  const sendPin = async (said: string) => {
    if (!draft || !said.trim()) return;
    const editor = editorRef.current!;
    const shape = editor.getShape(frameShapeId(draft.frameId) as TLShapeId)!;
    const fallback = `${draft.frameId} ${draft.pick.selector}: "${draft.pick.text.slice(0, 80)}"`;
    const snapshot = JSON.stringify({ frame: draft.frameId, selector: draft.pick.selector, text: draft.pick.text });
    const report = draftReport({
      observed: { kind: 'resource', locator: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } },
        base: base.current.revision ? { kind: 'revision', value: base.current.revision } : { kind: 'absent' }, dirty: false, snapshot, digest: await sha256(snapshot) },
      anchors: [{ kind: 'board.element@1', fallback, board: path, frame: draft.frameId, element: draft.pick.selector, text: draft.pick.text }],
      said: '', notes: [{ text: said.trim(), anchor: 0 }],
    }, { id: `fb_${randomUUID().replace(/[^1-9A-HJ-NP-Za-km-z]/g, '').padEnd(16, 'x').slice(0, 16)}`, created: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
    const pin = { id: report.id, frameId: draft.frameId, selector: draft.pick.selector, text: draft.pick.text, said: said.trim(), report: feedbackText(report),
      at: { x: shape.x + draft.pick.rect.x + draft.pick.rect.w, y: shape.y + draft.pick.rect.y } };
    setPins(current => [...current, pin]); onPin(pin); setDraft(null);
  };

  const context = useMemo<BoardContext>(() => ({ files: files ?? new Map(), css, commenting, frames, onPick: (frameId, pick) => setDraft({ frameId, pick }),
    onGo: (frameId, screen) => {
      const editor = editorRef.current, target = editor?.getShape(frameShapeId(`${frameId.split('/')[0]}/${screen}`) as TLShapeId);
      if (editor && target) editor.zoomToBounds(editor.getShapePageBounds(target)!, { animation: { duration: 300 }, inset: 40 });
    } }), [files, css, commenting, frames]);

  const components = useMemo(() => ({ InFrontOfTheCanvas: () => <Pins pins={pinsRef.current} /> }), [pins]); // eslint-disable-line react-hooks/exhaustive-deps
  if (parsed.kind !== 'ok') return <p role="alert" className="p-4 text-sm text-destructive">This board cannot be read ({parsed.reason}).</p>;
  if (!files) return <p role="status" className="p-4 text-sm text-muted-foreground">Loading board…</p>;
  return <Context.Provider value={context}>
    <div className="relative size-full min-h-0 overscroll-contain" data-testid="board" data-save={save} data-commenting={commenting} style={{ touchAction: 'none' }}>
      <Tldraw shapeUtils={[BoardFrameUtil]} hideUi={phone} assetUrls={assetUrls} onMount={onMount} {...(licenseKey ? { licenseKey } : {})}
        components={components} />
      <div className={`absolute left-1/2 z-[400] flex -translate-x-1/2 items-center gap-2 ${phone ? 'bottom-[calc(env(safe-area-inset-bottom)+12px)]' : 'top-2'}`} data-feedback-ignore="">
        <span className="rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm" data-testid="board-save">{save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'conflict' ? 'Changed elsewhere' : 'Save failed'}</span>
        <Button size="sm" variant={commenting ? 'default' : 'outline'} aria-pressed={commenting} data-testid="board-comment" className="pointer-coarse:min-h-11"
          onClick={() => { setCommenting(value => !value); setDraft(null); }}>{commenting ? 'Done' : 'Comment'}</Button>
      </div>
      {draft && <form className="absolute inset-x-2 bottom-20 z-[400] mx-auto flex max-w-md gap-2 rounded-xl border border-border bg-popover p-2 shadow-lg" data-testid="board-pin-form"
        onSubmit={event => { event.preventDefault(); void sendPin(String(new FormData(event.currentTarget).get('said') ?? '')); }}>
        <Input name="said" autoFocus placeholder={`Comment on “${draft.pick.text.slice(0, 40) || draft.pick.selector}”`} data-testid="board-pin-input" className="min-h-11 flex-1" />
        <Button type="submit" className="min-h-11" data-testid="board-pin-send">Send</Button>
      </form>}
    </div>
  </Context.Provider>;
}

/** Pins follow the camera (page space shown in screen space). They are not board content: the report is what the PM receives. */
function Pins({ pins }: { readonly pins: readonly BoardPin[] }) {
  const editor = useEditor();
  useValue('camera', () => editor.getCamera(), [editor]);
  return <>{pins.map((pin, index) => { const at = editor.pageToViewport(pin.at); return <div key={pin.id} data-testid="board-pin" title={pin.said}
    className="absolute z-[300] flex size-7 items-center justify-center rounded-full rounded-bl-none bg-primary text-xs font-semibold text-primary-foreground shadow-md ring-2 ring-background"
    style={{ left: at.x, top: at.y - 28, pointerEvents: 'none' }}>{index + 1}</div>; })}</>;
}

/** The document snapshot's size, for the persistence question (how heavy tldraw's own JSON would be if it were the artifact). */
export const snapshotBytes = (editor: Editor) => new TextEncoder().encode(JSON.stringify(getSnapshot(editor.store).document)).length;
