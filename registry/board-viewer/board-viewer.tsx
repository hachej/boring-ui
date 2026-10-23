'use client';

import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ResourceClient, ResourceLocator } from '@hachej/boring-files';
import { createTextBuffer } from '@hachej/boring-ui-kit/text-buffer';
import type { TextBuffer } from '@hachej/boring-ui-kit/text-buffer';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { BoardHostProps, BoardViewerProps } from './board-props';
export type { BoardHostProps, BoardViewerProps } from './board-props';
import { parseBoard } from './board';

export { parseBoard, planBoard, applyCanvasEdits, serializeBoard } from './board';
export type { Board, BoardPlan } from './board';
const Canvas = lazy(() => import('./board-canvas'));

const readText = (snapshot: Parameters<Parameters<typeof createTextBuffer>[0]['readText']>[0]) => {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes);
  if (parseBoard(text).kind !== 'ok') throw new Error('Unreadable board');
  return text;
};

export function BoardViewer(props: BoardViewerProps) {
  const parsed = useMemo(() => parseBoard(props.text), [props.text]);
  if (parsed.kind !== 'ok') return <Alert role="alert"><AlertTitle>{parsed.kind === 'newer' ? 'Newer board format' : 'This board cannot be read'}</AlertTitle>
    <AlertDescription>{parsed.kind === 'newer' ? parsed.format : parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')}</AlertDescription></Alert>;
  const key = JSON.stringify([props.target, props.identity, props.pinned]);
  return <BoardSession key={key} {...props} />;
}

function BoardSession({ text, revision, target, pinned, client, identity, ...host }: BoardViewerProps) {
  const [buffer, setBuffer] = useState<TextBuffer>();
  useEffect(() => {
    const next = createTextBuffer({ client, identity, instanceId: 'board', epoch: revision, readOnly: pinned || !client.publish,
      source: { kind: 'saved', snapshot: { ref: { ...target, revision }, bytes: new TextEncoder().encode(text), mediaType: 'application/json' } },
      mediaType: 'application/json', readText });
    setBuffer(next);
    return () => next.dispose();
    // A changed revision refreshes the existing buffer below; it must not replace a dirty canvas.
  }, [client, identity, target, pinned]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!buffer || pinned) return;
    const state = buffer.getSnapshot();
    if (state.base.kind === 'revision' && state.base.target.revision !== revision) void buffer.refresh(false);
  }, [buffer, text, revision, pinned]);
  return buffer ? <BoardDocument {...host} buffer={buffer} client={client} target={target} pinned={pinned} /> : <p role="status">Loading board…</p>;
}

function BoardDocument({ buffer, client, target, pinned, ...host }: Omit<BoardHostProps, 'identity'> & { readonly buffer: TextBuffer; readonly target: ResourceLocator; readonly pinned: boolean }) {
  const state = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot, buffer.getSnapshot);
  const parsed = useMemo(() => parseBoard(state.text), [state.text]);
  // Layout-only edits must not fetch linked files or remount the projection.
  const sources = parsed.kind === 'ok' ? JSON.stringify([...new Set(parsed.board.items.flatMap(item => 'maquette' in item ? [item.maquette] : 'html' in item ? [item.html] : []))]) : '[]';
  const [loaded, setLoaded] = useState<{ readonly sources: string; readonly files: ReadonlyMap<string, string> }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setError(undefined);
    const paths: string[] = JSON.parse(sources);
    const folder = target.resource.path.slice(0, target.resource.path.lastIndexOf('/') + 1);
    void Promise.all(paths.map(async relative => {
      const result = await client.read({ target: { ...target, resource: { ...target.resource, path: folder + relative } }, revision: { kind: 'latest' } });
      if (result.kind !== 'available') throw new Error('Linked files are unavailable');
      return [relative, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.snapshot.bytes)] as const;
    })).then(entries => { if (live) setLoaded({ sources, files: new Map(entries) }); }, () => { if (live) setError('Linked files are unavailable. Reload the board to retry.'); });
    return () => { live = false; };
  }, [client, target, sources]);
  const outcome = state.save.kind === 'settled' ? state.save.result : undefined;
  const conflict = state.remote !== null || outcome?.kind === 'conflict';
  const unknown = outcome?.kind === 'unknown';
  const pending = state.save.kind === 'pending';
  const run = (action: () => Promise<unknown>) => { void action().catch(() => setError('Board operation failed. Your local edits are retained.')); };
  return <section className="flex h-full min-h-0 flex-col" data-boring="board-viewer">
    <div role="status" data-testid="board-save" className="text-muted-foreground">{pinned ? 'Read only' : pending ? 'Saving…' : unknown ? 'Save unconfirmed' : conflict ? 'Changed elsewhere' : outcome && outcome.kind !== 'saved' ? 'Save failed' : state.dirty ? 'Unsaved changes' : 'Saved'}</div>
    {conflict && <Alert role="alert" data-testid="board-conflict"><AlertTitle>Changed elsewhere</AlertTitle><AlertDescription>Your local edits have been kept.</AlertDescription>
      <Button disabled={pending || unknown} onClick={() => run(() => buffer.refresh(true))}>Discard local changes and reload</Button></Alert>}
    {unknown && <Alert role="alert"><AlertTitle>Save unconfirmed</AlertTitle><AlertDescription>Your local edits have been kept. Do not repeat the save.</AlertDescription>
      <Button onClick={() => run(buffer.reconcile)}>Check save outcome</Button><Button onClick={() => run(buffer.abandon)}>Keep draft and refresh</Button></Alert>}
    {error && <Alert role="alert"><AlertTitle>{error}</AlertTitle></Alert>}
    {!error && loaded?.sources === sources && parsed.kind === 'ok' && <Suspense fallback={<p role="status">Loading board…</p>}>
      <Canvas {...host} buffer={buffer} files={loaded.files} />
    </Suspense>}
  </section>;
}
