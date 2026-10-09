'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { CodeXmlIcon, EyeIcon, RotateCcwIcon, SaveIcon, SearchCheckIcon } from 'lucide-react';
import { HtmlViewer } from '@hachej/boring-ui-kit/html-viewer';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import { IconButton } from '../button/button';
import { downloadFile, fileNameFor } from './download';
import { copyText } from '../utils/utils';
import { InteractiveFrame } from './interactive-html';
import type { InteractiveHtml } from './interactive-html';
import { ViewerFrame, ViewerToggle } from './viewer-frame';
import type { ViewerShare, ViewerStatus } from './viewer-frame';
import { defaultViewerLabels, useViewerText } from './viewer-window';
import type { ViewerLabels } from './viewer-window';

export type HtmlPaneMode = 'preview' | 'source';

export interface HtmlPaneProps {
  /** Borrowed: the host owns the controller and disposes it. */
  readonly controller: HtmlController;
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly target?: unknown;
  readonly revision?: string;
  readonly initialMode?: HtmlPaneMode;
  /** Reports the person's choice, so a host that remounts the pane (for a new revision) can start it in the same mode. */
  readonly onModeChange?: (mode: HtmlPaneMode) => void;
  /**
   * Host opt-in (off by default): the preview then runs the page's own scripts in a sandboxed frame with an opaque origin and a
   * Content-Security-Policy limited to inline code and `scriptSources`. See registry/README.md. Without it the preview is the passive,
   * script-free rendering of `@hachej/boring-ui-kit/html-viewer`.
   */
  readonly interactive?: InteractiveHtml;
  readonly controls?: ReactNode;
  readonly onRefresh?: () => unknown;
  readonly onShare?: ViewerShare;
  readonly onOpenInNewTab?: () => unknown;
  readonly onClose?: () => unknown;
  readonly testId?: string;
  /** Overrides the title's `data-testid` (default `<testId>-title`). */
  readonly titleTestId?: string;
  readonly className?: string;
  /** The pane's and its bar's words, over the window's and `defaultViewerLabels`. */
  readonly labels?: Partial<ViewerLabels> | undefined;
}

export function htmlStatus(state: ReturnType<HtmlController['getSnapshot']>, labels: ViewerLabels = defaultViewerLabels): ViewerStatus {
  if (state.lifecycle === 'disposed') return { label: labels.closed };
  if (state.save.kind === 'pending') return { label: labels.saving };
  if (state.save.kind === 'settled' && state.save.result.kind === 'unknown') return { label: labels.saveUnconfirmed, tone: 'warning' };
  if (state.remote !== null || state.save.kind === 'settled' && state.save.result.kind === 'conflict') return { label: labels.changedElsewhere, tone: 'warning' };
  if (state.readOnly) return { label: labels.readOnly, kind: 'read-only' };
  return state.dirty ? { label: labels.unsaved, tone: 'warning' } : { label: labels.saved, tone: 'success', kind: 'saved' };
}

/** The HTML safe preview and source editor in the standard viewer frame. The preview never runs scripts; a host-enabled interactive preview runs them, in a sandbox. */
export function HtmlPane({ controller, labels: ownLabels, title = 'HTML document', subtitle, target, revision, initialMode = 'preview', onModeChange, interactive, controls, onRefresh, onShare, onOpenInNewTab, onClose, testId = 'viewer', titleTestId, className }: HtmlPaneProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { labels } = useViewerText(ownLabels);
  const [mode, setModeState] = useState<HtmlPaneMode>(initialMode);
  const setMode = (next: HtmlPaneMode) => { setModeState(next); onModeChange?.(next); };
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string>();
  const pending = state.save.kind === 'pending';
  const unconfirmed = state.save.kind === 'settled' && state.save.result.kind === 'unknown';
  const disposed = state.lifecycle === 'disposed';
  const perform = (action: () => Promise<{ readonly kind: string; readonly reason?: string }>) => {
    setError(undefined);
    void Promise.resolve().then(action).then(result => { if ((result.kind === 'denied' || result.kind === 'unavailable') && result.reason) setError(result.reason); })
      .catch(() => setError(labels.operationFailed));
  };
  const filename = useMemo(() => fileNameFor(title, 'html'), [title]);
  return <ViewerFrame title={title} subtitle={subtitle} status={htmlStatus(state, labels)} labels={labels} target={target} revision={revision} testId={testId} {...(titleTestId ? { titleTestId } : {})} className={className}
    onRefresh={() => { if (interactive && mode === 'preview') setReload(count => count + 1); return (onRefresh ?? (() => controller.actions.refresh()))(); }} onShare={onShare} onCopy={() => copyText(controller.getSnapshot().text)}
    onDownload={() => downloadFile(filename, controller.getSnapshot().text, 'text/html;charset=utf-8')} onOpenInNewTab={onOpenInNewTab} onClose={onClose}
    controls={<>
      <ViewerToggle label={labels.view} value={mode} onChange={setMode} options={[
        { id: 'preview', label: labels.htmlPreview, text: labels.preview, icon: <EyeIcon className="size-4" aria-hidden="true" />, testId: `${testId}-mode-preview` },
        { id: 'source', label: labels.htmlSource, text: labels.source, icon: <CodeXmlIcon className="size-4" aria-hidden="true" />, testId: `${testId}-mode-source` }]} />
      {!state.readOnly && state.dirty && <IconButton label={labels.save} variant="default" data-testid={`${testId}-save`} disabled={disposed || pending || unconfirmed} onClick={() => perform(() => controller.flush(controller.actions.selection()))}><SaveIcon className="size-4" aria-hidden="true" /></IconButton>}
      {unconfirmed && <IconButton label={labels.checkSave} onClick={() => perform(controller.actions.reconcile)}><SearchCheckIcon className="size-4" aria-hidden="true" /></IconButton>}
      {unconfirmed && <IconButton label={labels.abandon} onClick={() => perform(controller.actions.abandon)}><RotateCcwIcon className="size-4" aria-hidden="true" /></IconButton>}
      {state.remote !== null && <IconButton label={labels.discardLocal} disabled={pending || unconfirmed} onClick={() => perform(controller.actions.discardToRemote)}><RotateCcwIcon className="size-4" aria-hidden="true" /></IconButton>}
      {controls}
    </>}>
    {error && <p role="alert" className="m-0 border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
    {interactive && mode === 'preview'
      ? <InteractiveFrame text={state.text} sources={interactive.scriptSources} reload={reload} title={`${title} (running)`} testId={testId} />
      : <HtmlViewer controller={controller} title={title} header={false} mode={mode === 'source' ? 'source' : 'preview'} onModeChange={next => setMode(next)} className="boring-html-pane" />}
  </ViewerFrame>;
}
