'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { CodeXmlIcon, PencilLineIcon, SaveIcon } from 'lucide-react';
import { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import type { MarkdownImageResolver, MarkdownMountedTools, MarkdownRichSafety } from '@hachej/boring-ui-kit/markdown-editor';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { IconButton } from '../button/button';
import { downloadFile, fileNameFor } from './download';
import { copyText } from '../utils/utils';
import { ViewerFrame, ViewerToggle } from './viewer-frame';
import type { ViewerShare, ViewerStatus } from './viewer-frame';
import { defaultViewerLabels, useViewerText } from './viewer-window';
import type { ViewerLabels } from './viewer-window';

export interface MarkdownPaneProps {
  /** Borrowed: the host owns the controller and disposes it. */
  readonly controller: MarkdownController;
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly target?: unknown;
  readonly revision?: string;
  readonly initialMode?: 'rich' | 'source';
  /** Reports the person's choice, so a host that remounts the pane (for a new revision) can start it in the same mode. */
  readonly onModeChange?: (mode: 'rich' | 'source') => void;
  readonly placeholder?: string;
  /** Extra viewer controls, for example a version switcher. */
  readonly controls?: ReactNode;
  /** Defaults to the controller's refresh: a clean document follows the saved one, unsaved edits are kept and shown as changed elsewhere. */
  readonly onRefresh?: () => unknown;
  readonly onShare?: ViewerShare;
  readonly onOpenInNewTab?: () => unknown;
  readonly onClose?: () => unknown;
  /** Host mapping from an image address in the document to a loadable URL. Images stay inert without it. */
  readonly resolveImage?: MarkdownImageResolver;
  readonly onMountedTools?: (tools: MarkdownMountedTools | null) => void;
  readonly testId?: string;
  /** Overrides the title's `data-testid` (default `<testId>-title`). */
  readonly titleTestId?: string;
  readonly className?: string;
  /** The pane's and its bar's words, over the window's and `defaultViewerLabels`. */
  readonly labels?: Partial<ViewerLabels> | undefined;
}

/** The status chip for a Markdown controller: Saved, Unsaved, Saving, Changed elsewhere, Read-only. */
export function markdownStatus(state: ReturnType<MarkdownController['getSnapshot']>, labels: ViewerLabels = defaultViewerLabels): ViewerStatus {
  if (state.lifecycle === 'disposed') return { label: labels.closed };
  if (state.save.kind === 'pending') return { label: labels.saving };
  if (state.save.kind === 'settled' && state.save.result.kind === 'unknown') return { label: labels.saveUnconfirmed, tone: 'warning' };
  if (state.save.kind === 'settled' && state.save.result.kind === 'conflict' || state.remote !== null) return { label: labels.changedElsewhere, tone: 'warning' };
  if (state.readOnly) return { label: labels.readOnly, kind: 'read-only' };
  return state.dirty ? { label: labels.unsaved, tone: 'warning' } : { label: labels.saved, tone: 'success', kind: 'saved' };
}

/** The Markdown editor in the standard viewer frame: mode toggle, Save while there are edits, Share, and Reload, Copy and Download under the "…" menu. */
export function MarkdownPane({ controller, title: givenTitle, labels: ownLabels, subtitle, target, revision, initialMode = 'rich', onModeChange, placeholder, controls, onRefresh, onShare, onOpenInNewTab, onClose, resolveImage, onMountedTools, testId = 'viewer', titleTestId, className }: MarkdownPaneProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { labels } = useViewerText(ownLabels);
  const title = givenTitle ?? labels.document;
  const [requested, setRequestedState] = useState<'rich' | 'source'>(initialMode);
  const setRequested = (next: 'rich' | 'source') => { setRequestedState(next); onModeChange?.(next); };
  const [safety, setSafety] = useState<MarkdownRichSafety>({ safe: true });
  const mode = safety.safe ? requested : 'source';
  const unavailable = state.readOnly || state.lifecycle !== 'active';
  const pending = state.save.kind === 'pending';
  const unconfirmed = state.save.kind === 'settled' && state.save.result.kind === 'unknown';
  const [refused, setRefused] = useState<{ readonly version: number; readonly label: string } | null>(null);
  const save = () => {
    setRefused(null);
    const version = controller.getSnapshot().bufferVersion;
    void controller.flush(controller.actions.selection()).then(result => {
      if (result.kind === 'denied' || result.kind === 'conflict' || result.kind === 'unavailable') {
        const reason = result.reason ?? (result.kind === 'conflict' ? labels.changedElsewhereReason : result.kind);
        setRefused({ version, label: labels.notSaved(reason.length > 48 ? `${reason.slice(0, 47)}…` : reason) });
      }
    }, () => setRefused({ version, label: labels.notSaved(labels.saveFailedReason) }));
  };
  const filename = useMemo(() => fileNameFor(title, 'md'), [title]);
  return <ViewerFrame title={title} subtitle={subtitle} status={refused && refused.version === state.bufferVersion && state.save.kind !== 'pending' ? { label: refused.label, tone: 'warning' } : markdownStatus(state, labels)} target={target} labels={labels} revision={revision} testId={testId} {...(titleTestId ? { titleTestId } : {})} className={className}
    onRefresh={onRefresh ?? (() => controller.actions.refresh())} onShare={onShare} onCopy={() => copyText(controller.getSnapshot().text)}
    onDownload={() => downloadFile(filename, controller.getSnapshot().text, 'text/markdown;charset=utf-8')} onOpenInNewTab={onOpenInNewTab} onClose={onClose}
    controls={<>
      <ViewerToggle label={labels.editorMode} value={mode} onChange={setRequested} options={[
        { id: 'rich', label: labels.richText, text: labels.rich, icon: <PencilLineIcon className="size-4" aria-hidden="true" />, disabled: !safety.safe, testId: `${testId}-mode-rich` },
        { id: 'source', label: labels.markdownSource, text: labels.source, icon: <CodeXmlIcon className="size-4" aria-hidden="true" />, testId: `${testId}-mode-source` }]} />
      {!state.readOnly && state.dirty && <IconButton label={labels.save} variant="default" data-testid={`${testId}-save`} disabled={unavailable || pending || unconfirmed} onClick={save}><SaveIcon className="size-4" aria-hidden="true" /></IconButton>}
      {controls}
    </>}>
    <MarkdownEditor controller={controller} title={title} header={false} mode={mode} onModeChange={setRequested} onRichSafety={setSafety}
      {...(placeholder === undefined ? {} : { placeholder })} {...(resolveImage ? { resolveImage } : {})} {...(onMountedTools ? { onMountedTools } : {})} className="boring-markdown-editor" />
  </ViewerFrame>;
}
