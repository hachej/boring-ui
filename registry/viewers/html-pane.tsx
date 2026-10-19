'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { RotateCcwIcon, SaveIcon, SearchCheckIcon } from 'lucide-react';
import { HtmlViewer } from '@hachej/boring-ui-kit/html-viewer';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import { Button } from '@/components/ui/button';
import { editorControls } from '../button/editor-controls';
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
  /** Leading header content, before the title. */
  readonly headerStart?: ReactNode;
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
  if (state.save.kind === 'pending') return { label: labels.saving, tone: 'warning', kind: 'saving' };
  if (state.save.kind === 'settled' && state.save.result.kind === 'unknown') return { label: labels.saveUnconfirmed, tone: 'danger' };
  if (state.remote !== null || state.save.kind === 'settled' && state.save.result.kind === 'conflict') return { label: labels.changedElsewhere, tone: 'danger' };
  if (state.readOnly) return { label: labels.readOnly, kind: 'read-only' };
  return state.dirty ? { label: labels.unsaved, tone: 'warning' } : { label: labels.saved, tone: 'success', kind: 'saved' };
}

/** The HTML safe preview and source editor in the standard viewer frame. The preview never runs scripts; a host-enabled interactive preview runs them, in a sandbox. */
export function HtmlPane({ controller, labels: ownLabels, title = 'HTML document', subtitle, target, revision, initialMode = 'preview', onModeChange, interactive, headerStart, controls, onRefresh, onShare, onOpenInNewTab, onClose, testId = 'viewer', titleTestId, className }: HtmlPaneProps) {
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
    void Promise.resolve().then(action).then(result => { if ((result.kind === 'denied' || result.kind === 'unavailable' || result.kind === 'file_too_large') && result.reason) setError(result.reason); })
      .catch(() => setError(labels.operationFailed));
  };
  const filename = useMemo(() => fileNameFor(title, 'html'), [title]);
  return <ViewerFrame title={title} subtitle={subtitle} headerStart={headerStart} status={htmlStatus(state, labels)} labels={labels} target={target} revision={revision} testId={testId} {...(titleTestId ? { titleTestId } : {})} className={className}
    onRefresh={() => { if (interactive && mode === 'preview') setReload(count => count + 1); return (onRefresh ?? (() => controller.actions.refresh()))(); }} onShare={onShare} onCopy={() => copyText(controller.getSnapshot().text)}
    onDownload={() => downloadFile(filename, controller.getSnapshot().text, 'text/html;charset=utf-8')} onOpenInNewTab={onOpenInNewTab} onClose={onClose}
    controls={<>
      <ViewerToggle label={labels.view} value={mode} onChange={setMode} options={[
        { id: 'preview', label: labels.htmlPreview, text: labels.preview, testId: `${testId}-mode-preview` },
        { id: 'source', label: labels.htmlSource, text: labels.source, testId: `${testId}-mode-source` }]} />
      {!state.readOnly && state.dirty && <Button variant="ghost" size="icon-sm" aria-label={labels.save} title={labels.save} data-testid={`${testId}-save`} disabled={disposed || pending || unconfirmed} onClick={() => perform(() => controller.flush(controller.actions.selection()))}><SaveIcon data-icon="inline-start" aria-hidden="true" /></Button>}
      {unconfirmed && <Button variant="ghost" size="icon-sm" aria-label={labels.checkSave} title={labels.checkSave} onClick={() => perform(controller.actions.reconcile)}><SearchCheckIcon data-icon="inline-start" aria-hidden="true" /></Button>}
      {unconfirmed && <Button variant="ghost" size="icon-sm" aria-label={labels.abandon} title={labels.abandon} onClick={() => perform(controller.actions.abandon)}><RotateCcwIcon data-icon="inline-start" aria-hidden="true" /></Button>}
      {state.remote !== null && <Button variant="ghost" size="icon-sm" aria-label={labels.discardLocal} title={labels.discardLocal} disabled={pending || unconfirmed} onClick={() => perform(controller.actions.discardToRemote)}><RotateCcwIcon data-icon="inline-start" aria-hidden="true" /></Button>}
      {controls}
    </>}>
    {error && <p role="alert" className="m-0 px-3 py-2">{error}</p>}
    {interactive && mode === 'preview'
      ? <InteractiveFrame text={state.text} sources={interactive.scriptSources} reload={reload} title={`${title} (running)`} testId={testId} />
      : <HtmlViewer components={editorControls} controller={controller} title={title} header={false} mode={mode === 'source' ? 'source' : 'preview'} onModeChange={next => setMode(next)} className="boring-html-pane" />}
  </ViewerFrame>;
}
