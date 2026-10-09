// The viewer shown inside the ambient window when an artifact card is opened (AmbientChat `artifactPanel`). It is the host's code: the
// standard viewer bar (title, type, copy, download, close, full screen) over the viewer for the artifact's type, read through
// the same authenticated resource endpoint the host's own panels use. Documents are read-only here; artifact content is never executed
// (HTML runs only in the viewer's sandboxed preview when the host opts in, which this demo does not).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import { typeLabel } from '../../registry/pi-chat/artifact.ts';
import { CodeBlock } from '../../registry/pi-chat/code-block.tsx';
import { HtmlPane } from '../../registry/viewers/html-pane.tsx';
import { MarkdownPane } from '../../registry/viewers/markdown-pane.tsx';
import { ViewerFrame, ViewerWindowProvider } from '../../registry/viewers/viewer-frame.tsx';
import { downloadFile } from '../../registry/viewers/download.ts';
import { copyText } from '../../registry/utils/utils.ts';
import { randomUUID } from '@hachej/boring-files/platform';
import { savedLabel, useSaved } from '../../registry/pi-app/use-saved.ts';

const NOOP = () => () => {};
const EXTENSION = /\.([A-Za-z0-9]{1,8})$/;

/** When the shown revision of the file was saved, from the workspace provider's history; undefined until known. */
function useSavedAt(api, path, revision) {
  const [savedAt, setSavedAt] = useState();
  useEffect(() => {
    let cancelled = false;
    if (!revision) return undefined;
    api(new Request(new URL(`/api/history?path=${encodeURIComponent(path)}`, location.href))).then(response => response.json()).then(result => { if (!cancelled) setSavedAt(result.saves.find(save => save.revision === revision)?.savedAt); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, path, revision]);
  return savedAt;
}

function Version({ artifact, pinned, follow, client, identity, authorized, onClose }) {
  const { type } = artifact;
  const create = useMemo(() => {
    const base = snapshot => ({ identity, client, instanceId: randomUUID(), epoch: 'ambient', source: { kind: 'saved', snapshot } });
    if (type === 'markdown') return snapshot => createMarkdownController({ ...base(snapshot), readOnly: true });
    if (type === 'html') return snapshot => createHtmlController({ ...base(snapshot), readOnly: true });
    return undefined;
  }, [type, client, identity]);
  const saved = useSaved({ client, target: artifact.target, revision: pinned ? artifact.revision : undefined, create });
  const controller = saved.controller;
  const text = useSyncExternalStore(controller ? controller.subscribe : NOOP, () => controller ? controller.getSnapshot().text : saved.text, () => saved.text);
  const revision = saved.kind === 'open' ? saved.snapshot.ref.revision : undefined;
  const savedAt = useSavedAt(authorized, artifact.target.resource.path, revision);
  const frame = {
    title: artifact.title, testId: 'artifact', titleTestId: 'artifact-panel-title', onClose, status: { label: 'Read-only' },
    subtitle: <><span data-testid="artifact-panel-type">{typeLabel(artifact)}</span><span aria-hidden="true">·</span>
      <span data-testid="artifact-panel-version">{pinned ? 'Older version' : savedAt ? `Latest, saved ${savedLabel(savedAt)}` : 'Latest'}</span></>,
  };
  const body = children => <div data-testid="artifact-body" data-state={saved.kind} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
  if (saved.kind !== 'open') return body(<ViewerFrame {...frame}><p className="m-0 p-4 text-sm text-muted-foreground" role="status">{saved.kind === 'loading' ? 'Loading…' : saved.kind === 'invalid' ? 'This artifact cannot be shown as text.' : 'This version is not available.'}</p></ViewerFrame>);
  const document = children => <div data-testid="document" data-revision={saved.snapshot.ref.revision} className="h-full min-h-0">{children}</div>;
  if (type === 'markdown') return body(document(<MarkdownPane controller={controller} initialMode="rich" {...frame} />));
  if (type === 'html') return body(document(<HtmlPane controller={controller} {...frame} />));
  const extension = EXTENSION.exec(artifact.target.resource.path)?.[1] ?? 'txt';
  const filename = `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact'}.${extension}`;
  return body(<ViewerFrame {...frame} onCopy={() => copyText(text ?? '')} onDownload={() => downloadFile(filename, text ?? '', `${artifact.mediaType};charset=utf-8`)}>
    <div className="min-h-0 flex-1 overflow-auto p-3"><CodeBlock code={saved.text} language={artifact.language ?? 'text'} /></div></ViewerFrame>);
}

/** Returns the `artifactPanel` render function for `AmbientChat`. */
export function createArtifactPanel({ identity, authorized }) {
  const client = createResourceClient({ identity, endpoint: new URL('/api/resources', location.href), publication: true, reconciliation: true, fetch: authorized });
  return (artifact, api) => {
    const path = artifact.target.resource.path;
    return <ViewerWindowProvider value={{ fullscreen: api.fullscreen, onFullscreenChange: api.onFullscreenChange }}>
      <div data-testid="artifact-panel" data-artifact-id={artifact.id} data-artifact-type={artifact.type} data-follow={api.follow ? 'true' : 'false'}
        className="pi-chat flex h-full min-h-0 flex-col">
        <Version key={`${path}@${api.follow ? 'latest' : artifact.revision}`} artifact={artifact} pinned={!api.follow} follow={api.follow} client={client} identity={identity}
          authorized={authorized} onClose={api.close} />
      </div>
    </ViewerWindowProvider>;
  };
}
