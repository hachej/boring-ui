'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { CodeXmlIcon, PencilLineIcon, SaveIcon } from 'lucide-react';
import { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import type { MarkdownEditorProps, MarkdownImageResolver, MarkdownMountedTools, MarkdownRichSafety } from '@hachej/boring-ui-kit/markdown-editor';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { Button } from '@/components/ui/button';
import { editorControls } from '../button/editor-controls';
import { downloadFile, fileNameFor } from './download';
import { copyText } from '../utils/utils';
import { ViewerFrame, ViewerToggle } from './viewer-frame';
import type { ViewerShare, ViewerStatus } from './viewer-frame';
import { defaultViewerLabels, useViewerText, useViewerWindow } from './viewer-window';
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
  /** Defaults to 1200ms idle autosave; false keeps the Save button. */
  readonly autosave?: MarkdownEditorProps['autosave'];
  /** Registers the flush for owner teardown; this is not a navigation guard. */
  readonly onAutosaveChange?: MarkdownEditorProps['onAutosaveChange'];
  /** Registers with a host navigation guard whose onClose handles refused saves and deliberate discard. */
  readonly onBeforeLeaveChange?: MarkdownEditorProps['onAutosaveChange'];
  /** Pinned by default on desktop. Phones always use the selection bubble. */
  readonly formattingToolbar?: MarkdownEditorProps['formattingToolbar'];
  /** Leading header content, before the title. */
  readonly headerStart?: ReactNode;
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

/** The status dot for a Markdown controller: Saved (green), Unsaved or Saving (amber), Save unconfirmed or Changed elsewhere (red, with words), Read-only. */
export function markdownStatus(state: ReturnType<MarkdownController['getSnapshot']>, labels: ViewerLabels = defaultViewerLabels): ViewerStatus {
  if (state.lifecycle === 'disposed') return { label: labels.closed };
  if (state.save.kind === 'pending') return { label: labels.saving, tone: 'warning', kind: 'saving' };
  if (state.save.kind === 'settled' && state.save.result.kind === 'unknown') return { label: labels.saveUnconfirmed, tone: 'danger' };
  if (state.save.kind === 'settled' && state.save.result.kind === 'conflict' || state.remote !== null) return { label: labels.changedElsewhere, tone: 'danger' };
  if (state.readOnly) return { label: labels.readOnly, kind: 'read-only' };
  return state.dirty ? { label: labels.unsaved, tone: 'warning' } : { label: labels.saved, tone: 'success', kind: 'saved' };
}

/** The Markdown editor in the standard viewer frame: mode toggle, Save while there are edits, Share, and Reload, Copy and Download under the "…" menu. */
export function MarkdownPane({ controller, title: givenTitle, labels: ownLabels, subtitle, target, revision, initialMode = 'rich', onModeChange, placeholder, formattingToolbar = 'pinned', autosave: ownAutosave, onAutosaveChange, onBeforeLeaveChange, headerStart, controls, onRefresh, onShare, onOpenInNewTab, onClose, resolveImage, onMountedTools, testId = 'viewer', titleTestId, className }: MarkdownPaneProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { labels } = useViewerText(ownLabels);
  const window = useViewerWindow();
  const autosave = ownAutosave ?? window?.autosave ?? true;
  const flush = useRef<(() => Promise<boolean>) | null>(null);
  const registerAutosave = useCallback((save: (() => Promise<boolean>) | null) => { flush.current = save; onAutosaveChange?.(save); onBeforeLeaveChange?.(save); }, [onAutosaveChange, onBeforeLeaveChange]);
  const close = onClose ? async () => {
    if (autosave !== false && flush.current && !await flush.current() && !onBeforeLeaveChange) return false;
    return onClose();
  } : undefined;
  const title = givenTitle ?? labels.document;
  const [requested, setRequestedState] = useState<'rich' | 'source'>(initialMode);
  const setRequested = (next: 'rich' | 'source') => { setRequestedState(next); onModeChange?.(next); };
  const [safety, setSafety] = useState<MarkdownRichSafety>({ safe: true });
  const mode = safety.safe ? requested : 'source';
  const unavailable = state.readOnly || state.lifecycle !== 'active';
  const pending = state.save.kind === 'pending';
  const unconfirmed = state.save.kind === 'settled' && state.save.result.kind === 'unknown';
  const [refused, setRefused] = useState<{ readonly save: typeof state.save; readonly label: string } | null>(null);
  const report: NonNullable<MarkdownEditorProps['onSaveResult']> = result => {
    if (result.kind === 'saved' || result.kind === 'conflict') setRefused(null);
    else if (result.kind === 'denied' || result.kind === 'unavailable' || result.kind === 'file_too_large') {
      const reason = result.reason ?? result.kind;
      setRefused({ save: controller.getSnapshot().save, label: labels.notSaved(reason.length > 48 ? `${reason.slice(0, 47)}…` : reason) });
    }
  };
  const save = () => {
    setRefused(null);
    void controller.flush(controller.actions.selection()).then(report, () => setRefused({ save: controller.getSnapshot().save, label: labels.notSaved(labels.saveFailedReason) }));
  };
  const filename = useMemo(() => fileNameFor(title, 'md'), [title]);
  return <ViewerFrame showSavedStatus title={title} subtitle={subtitle} headerStart={headerStart} status={refused && refused.save === state.save && state.save.kind !== 'pending' ? { label: refused.label, tone: 'danger' } : markdownStatus(state, labels)} target={target} labels={labels} revision={revision} testId={testId} {...(titleTestId ? { titleTestId } : {})} className={className}
    onRefresh={onRefresh ?? (() => controller.actions.refresh())} onShare={onShare} onCopy={() => copyText(controller.getSnapshot().text)}
    onDownload={() => downloadFile(filename, controller.getSnapshot().text, 'text/markdown;charset=utf-8')} onOpenInNewTab={onOpenInNewTab} onClose={close}
    controls={<>
      <ViewerToggle label={labels.editorMode} value={mode} onChange={setRequested} options={[
        { id: 'rich', label: labels.richText, text: labels.rich, icon: <PencilLineIcon data-icon="inline-start" aria-hidden="true" />, disabled: !safety.safe, reason: safety.safe ? undefined : labels.richUnavailable(safety.reasons.join(', ')), testId: `${testId}-mode-rich` },
        { id: 'source', label: labels.markdownSource, text: labels.source, icon: <CodeXmlIcon data-icon="inline-start" aria-hidden="true" />, testId: `${testId}-mode-source` }]} />
      {autosave === false && !state.readOnly && state.dirty && <Button variant="ghost" size="icon-sm" aria-label={labels.save} title={labels.save} data-testid={`${testId}-save`} disabled={unavailable || pending || unconfirmed} onClick={save}><SaveIcon data-icon="inline-start" aria-hidden="true" /></Button>}
      {controls}
    </>}>
    <MarkdownEditor components={editorControls} controller={controller} title={title} header={false} autosave={autosave} onAutosaveChange={registerAutosave} onSaveResult={report} formattingToolbar={formattingToolbar} mode={mode} onModeChange={setRequested} onRichSafety={setSafety}
      {...(placeholder === undefined ? {} : { placeholder })} {...(resolveImage ? { resolveImage } : {})} {...(onMountedTools ? { onMountedTools } : {})} className="boring-markdown-editor" />
  </ViewerFrame>;
}
