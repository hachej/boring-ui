'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeftIcon, CheckIcon, CircleIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ActionButton, actionMenuItem, headerActions, menuActions } from '../button/actions';
import type { BlockAction } from '../button/actions';
import { ViewerActions } from './menu';
import type { ViewerMenuItem } from './menu';
import { useViewerText, useViewerWindow } from './viewer-window';
import type { ViewerIcons, ViewerLabels } from './viewer-window';
import { cn } from '../utils/utils';
import type { ManualCopyError } from '../utils/utils';
import type { ViewerShare } from './share';

export type { ViewerShare, ViewerShareRequest, ViewerShareResult } from './share';
export { ViewerWindowProvider, defaultViewerIcons, defaultViewerLabels, useViewerText } from './viewer-window';
export type { ViewerIcons, ViewerLabels, ViewerWindow } from './viewer-window';

export type ViewerTone = 'neutral' | 'success' | 'warning' | 'danger';
/**
 * `kind` says what the status is whatever its (translated) label: the bar hides a plain `saved` (unless `showSavedStatus`), pulses the dot
 * while `saving` and shows `read-only` as a fact. The bar shows a coloured dot: `success` green, `warning` amber, `danger` red. Only a
 * `danger` status also shows its words, because the person must act on it; the others keep the label in the tooltip and for screen readers.
 */
export interface ViewerStatus { readonly label: string; readonly tone?: ViewerTone; readonly kind?: 'saved' | 'saving' | 'read-only' | undefined }

export interface ViewerFrameProps {
  /** What is shown, for example the file name. */
  readonly title: string;
  /** Type, version, path, size: short facts under the title. */
  readonly subtitle?: ReactNode;
  /** Saved, Unsaved, Saving, Changed elsewhere, Read-only. */
  readonly status?: ViewerStatus | undefined;
  /** Keep a quiet saved acknowledgement visible, for autosaving editors. */
  readonly showSavedStatus?: boolean | undefined;
  /** Opaque identifiers handed to `onShare` so the host can build a link to this exact thing. */
  readonly target?: unknown;
  readonly revision?: string | undefined;
  /** Leading header content, for example Back before the file title. */
  readonly headerStart?: ReactNode;
  /** Viewer-specific controls that stay visible: a mode toggle, Save while there are edits, zoom steps, a version switcher when there are several. */
  readonly controls?: ReactNode;
  /** Viewer-specific secondary actions, listed in the "…" menu after the standard ones. */
  readonly menu?: readonly ViewerMenuItem[];
  /**
   * The host's actions for this bar, after the window's (`ViewerWindow.actions`): `header` ones as buttons beside Share, `menu` ones at the
   * end of the "…" menu. Test ids `<testId>-<id>`.
   */
  readonly actions?: readonly BlockAction[] | undefined;
  /** This bar's words and icons, over the window's and the defaults (`defaultViewerLabels`, `defaultViewerIcons`). */
  readonly labels?: Partial<ViewerLabels> | undefined;
  readonly icons?: Partial<ViewerIcons> | undefined;
  /** Each standard action appears only when its handler is supplied. Share is always visible; Reload, Copy, Download and Open in new tab live in the "…" menu. */
  readonly onRefresh?: () => unknown;
  readonly onShare?: ViewerShare;
  readonly onCopy?: () => unknown;
  readonly onDownload?: () => unknown;
  readonly onOpenInNewTab?: () => unknown;
  readonly onClose?: () => unknown;
  /** Prefix of the `data-testid` of the bar and its actions (`viewer-share`, `viewer-more`, and `viewer-refresh` for the menu's Reload, ...). */
  readonly testId?: string;
  readonly titleTestId?: string;
  /** Quiet one-row bar with secondary actions in the menu. False retains the former visible Share/fullscreen/close layout. */
  readonly compactHeader?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}


/** Narrow panes drop optional controls. */
const TIGHT_WIDTH = { touch: 440, pointer: 340 };
const touchScreen = () => typeof matchMedia === 'function' && matchMedia('(max-width: 639px), (pointer: coarse)').matches;

/** How much room the bar has, for a pane that wants to drop optional controls (the zoom percentage, for example) on a narrow panel. */
export interface ViewerBarSpace { readonly tight: boolean }
const ViewerBarContext = createContext<ViewerBarSpace>({ tight: false });
export const useViewerBar = (): ViewerBarSpace => useContext(ViewerBarContext);
const NOTICE_MS = 2600;

/**
 * One choice of a mode toggle, for example Text | Markdown. `text` is the visible word, `label` the accessible name and the tooltip, `icon`
 * an optional mark before the word. A disabled choice shows `reason` as its tooltip.
 */
export interface ViewerToggleOption<T extends string> { readonly id: T; readonly label: string; readonly text: string; readonly icon?: ReactNode; readonly disabled?: boolean; readonly reason?: string | undefined; readonly testId?: string }

/** A segmented control over the consumer's outlined ToggleGroup: visible words, one pressed segment. */
export function ViewerToggle<T extends string>({ label, value, options, onChange }: { readonly label: string; readonly value: T; readonly options: readonly ViewerToggleOption<T>[]; readonly onChange: (id: T) => void }) {
  return <ToggleGroup aria-label={label} variant="outline" size="sm" spacing={0} value={[value]} onValueChange={values => {
    const selected = options.find(option => option.id === values[0] && !option.disabled);
    if (selected && selected.id !== value) onChange(selected.id);
  }}>
    {options.map(option => <ToggleGroupItem key={option.id} value={option.id} aria-label={option.label} title={option.disabled && option.reason ? option.reason : option.label} disabled={option.disabled}
      className="disabled:pointer-events-auto disabled:cursor-not-allowed" data-testid={option.testId} data-mode={option.id}>
      {option.icon}{option.text}</ToggleGroupItem>)}
  </ToggleGroup>;
}

/** The copy helper throws this when the browser allowed no automatic copy at all; the person copies by hand instead. */
const needsManualCopy = (error: unknown): error is ManualCopyError => (error as { name?: string } | null)?.name === 'ManualCopyError' && typeof (error as { text?: unknown }).text === 'string';

/** Last resort for Copy and Share: the text, already selected, so Ctrl/Cmd+C or the long-press menu finishes the job. */
function ManualCopy({ testId, link, text, onClose, labels }: { readonly testId: string; readonly link: boolean; readonly text: string; readonly onClose: () => void; readonly labels: ViewerLabels }) {
  const field = useRef<HTMLTextAreaElement>(null);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} className="boring-viewer" data-testid={`${testId}-manual-copy`} initialFocus={field}>
      <DialogHeader><DialogTitle>{labels.manualCopy(link)}</DialogTitle></DialogHeader>
      <Textarea ref={field} readOnly rows={Math.min(6, Math.max(2, Math.ceil(text.length / 48)))} value={text} data-testid={`${testId}-manual-copy-text`} onFocus={event => event.currentTarget.select()} />
      <div className="flex justify-end"><Button variant="ghost" size="sm" data-testid={`${testId}-manual-copy-close`} onClick={onClose}>{labels.done}</Button></div>
    </DialogContent>
  </Dialog>;
}

/** Dot colours: semantic tokens, with `--success`/`--warning` from the host theme (viewers.css falls back to the neutral roles). */
const DOTS: Record<ViewerTone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-(--viewer-success)',
  warning: 'text-(--viewer-warning)',
  danger: 'text-destructive',
};

/** The save status as a coloured dot; the label is the tooltip and the screen-reader text, and is shown only when the person must act (`danger`). */
function StatusMark({ status, testId }: { readonly status: ViewerStatus; readonly testId: string }) {
  const tone = status.tone ?? 'neutral';
  return <span role="status" aria-label={status.label} title={status.label} data-testid={`${testId}-status`} data-tone={tone} data-kind={status.kind}
    className="inline-flex h-6 min-w-6 shrink-0 cursor-default items-center justify-center gap-1.5 text-xs">
    <CircleIcon aria-hidden="true" strokeWidth={0} className={cn('size-2 shrink-0 fill-current', DOTS[tone], status.kind === 'saving' && 'animate-pulse motion-reduce:animate-none')} />
    <span data-testid={`${testId}-status-text`} className={tone === 'danger' ? 'max-w-48 truncate text-destructive' : 'sr-only'}>{status.label}</span>
  </span>;
}

/** The one top bar of every viewer, always a single row: title and facts, viewer controls, a status dot when something needs attention, Share, full screen, Close and the "…" menu. */
export function ViewerFrame({ title, subtitle, status, showSavedStatus = false, target, revision, headerStart, controls, menu, actions, labels: ownLabels, icons: ownIcons, onRefresh, onShare, onCopy, onDownload, onOpenInNewTab, onClose, testId = 'viewer', titleTestId, compactHeader = true, className, children }: ViewerFrameProps) {
  const bar = useRef<HTMLElement>(null);
  const [space, setSpace] = useState<ViewerBarSpace>({ tight: false });
  const [busy, setBusy] = useState<'refresh' | 'share' | undefined>();
  const [notice, setNotice] = useState<{ readonly text: string; readonly tone: ViewerTone } | undefined>();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<{ readonly text: string; readonly link: boolean } | undefined>();
  const host = useViewerWindow();
  const { labels, icons } = useViewerText(ownLabels, ownIcons);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      const next = { tight: width > 0 && width < (touchScreen() ? TIGHT_WIDTH.touch : TIGHT_WIDTH.pointer) };
      setSpace(now => now.tight === next.tight ? now : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [host?.renderHeader]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const guarded = useCallback(async (kind: 'refresh' | 'share', run: () => unknown, failed: string) => {
    setBusy(kind);
    setNotice(undefined);
    try { return await run(); }
    catch (error) { if (mounted.current) { if (needsManualCopy(error)) setManual({ text: error.text, link: kind === 'share' }); else setNotice({ text: failed, tone: 'danger' }); } return undefined; }
    finally { if (mounted.current) setBusy(undefined); }
  }, []);
  const refresh = () => { if (onRefresh) void guarded('refresh', onRefresh, labels.refreshFailed); };
  const share = () => {
    if (!onShare) return;
    void guarded('share', () => onShare({ title, target, revision }), labels.shareFailed).then(result => {
      if (!mounted.current) return;
      if (result === 'copied') setNotice({ text: labels.linkCopied, tone: 'success' });
      else if (result === 'shared') setNotice({ text: labels.shared, tone: 'success' });
    });
  };
  const copy = () => {
    void Promise.resolve().then(onCopy).then(() => { if (mounted.current) { setCopied(true); setNotice({ text: labels.copied, tone: 'success' }); setTimeout(() => { if (mounted.current) setCopied(false); }, 1500); } })
      .catch(error => { if (!mounted.current) return; if (needsManualCopy(error)) setManual({ text: error.text, link: false }); else setNotice({ text: labels.copyFailed, tone: 'danger' }); });
  };
  const run = (action: (() => unknown) | undefined) => { void Promise.resolve().then(action).catch(() => { if (mounted.current) setNotice({ text: labels.actionFailed, tone: 'danger' }); }); };
  // The host's actions: the window's (every viewer in the panel), then this frame's. Each runs through `run`, so a failure shows as a notice.
  const hostActions = [...host?.actions ?? [], ...actions ?? []].map(action => ({ ...action, onSelect: () => run(action.onSelect) }));

  const reading = status?.kind === 'read-only' || status?.label === labels.readOnly;
  const menuItems: ViewerMenuItem[] = ([
    ...(compactHeader && onShare ? [{ id: 'share', label: labels.share, icon: <icons.share className="size-4" />, onSelect: share }] : []),
    ...(compactHeader && host?.onFullscreenChange ? [{ id: 'fullscreen', label: host.fullscreen ? labels.exitFullscreen : labels.enterFullscreen, icon: <icons.enterFullscreen className="size-4" />, onSelect: () => host.onFullscreenChange!(!host.fullscreen) }] : []),
    ...(onRefresh ? [{ id: 'refresh', separatorBefore: true, label: labels.reload, icon: <RefreshCwIcon className="size-4" />, disabled: busy === 'refresh', onSelect: refresh }] : []),
    ...(onCopy ? [{ id: 'copy', label: labels.copy, icon: copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />, onSelect: copy }] : []),
    ...(onDownload ? [{ id: 'download', label: labels.download, icon: <DownloadIcon className="size-4" />, onSelect: () => run(onDownload) }] : []),
    ...(onOpenInNewTab ? [{ id: 'open', label: labels.openInNewTab, icon: <ExternalLinkIcon className="size-4" />, onSelect: () => run(onOpenInNewTab) }] : []),
    ...(menu ?? []).map((item, index) => ({ ...item, separatorBefore: index === 0 || item.separatorBefore })),
    ...menuActions(hostActions).map((action, index) => ({ ...actionMenuItem(action, testId), separatorBefore: index === 0 })),
  ] as ViewerMenuItem[]).map(entry => ({ ...entry, testId: entry.testId ?? `${testId}-${entry.id}` }));

  const stacked = !compactHeader && host?.headerLayout === 'stacked';
  const toolbar = controls && <div data-testid={`${testId}-controls`} className={cn('flex shrink-0 items-center gap-1', compactHeader && 'max-[641px]:hidden', stacked && 'flex-wrap px-3 py-2')}>{controls}</div>;
  const titlebar = <>
        {compactHeader && !headerStart && onClose && <Button variant="ghost" size="icon-sm" aria-label={labels.close} title={labels.close} data-testid={`${testId}-close`} onClick={() => run(onClose)}><ArrowLeftIcon data-icon="inline-start" className="min-[641px]:hidden" aria-hidden="true" /><icons.close data-icon="inline-start" className="hidden min-[641px]:block" aria-hidden="true" /></Button>}
        {headerStart}
        <div className="group/title relative min-w-0 flex-1 basis-0 text-left">
          <h2 data-testid={titleTestId ?? `${testId}-title`} title={title} className="m-0 truncate text-sm leading-5 font-semibold tracking-tight">{title}</h2>
          {(subtitle || reading) && <p data-testid={`${testId}-subtitle`} className={cn('m-0 flex min-w-0 items-center gap-x-1.5 text-xs leading-4 whitespace-nowrap text-muted-foreground', compactHeader ? 'hidden group-hover/title:flex max-[641px]:hidden' : 'overflow-hidden')}>{subtitle}{subtitle && reading && <span aria-hidden="true">·</span>}{reading && <span data-testid={`${testId}-readonly`}>{labels.readOnly}</span>}</p>}
        </div>
        {!stacked && toolbar}
        {status && !reading && (showSavedStatus || status.kind !== 'saved' && status.label !== labels.saved) && <StatusMark status={status} testId={testId} />}
        <div className="flex shrink-0 items-center gap-0.5">
          {headerActions(hostActions).map(action => <ActionButton key={action.id} action={action} testId={testId} size="icon-sm" />)}
          {!compactHeader && onShare && <Button variant="ghost" size="icon-sm" aria-label={labels.share} title={labels.share} data-testid={`${testId}-share`} disabled={busy === 'share'} onClick={share}><icons.share data-icon="inline-start" aria-hidden="true" /></Button>}
          {(menuItems.length > 0 || controls) && <ViewerActions label={labels.moreActions} testId={`${testId}-more`} icon={<icons.more data-icon="inline-start" aria-hidden="true" />} items={menuItems}>{compactHeader && controls && <div className="boring-viewer flex flex-wrap items-center gap-2 p-2 min-[641px]:hidden">{controls}</div>}</ViewerActions>}
          {!compactHeader && host?.onFullscreenChange && <Toggle size="sm" aria-label={host.fullscreen ? labels.exitFullscreen : labels.enterFullscreen} title={host.fullscreen ? labels.exitFullscreen : labels.enterFullscreen} data-testid={`${testId}-fullscreen`} pressed={host.fullscreen === true}
            onPressedChange={pressed => host.onFullscreenChange!(pressed)}>{host.fullscreen ? <icons.exitFullscreen data-icon="inline-start" aria-hidden="true" /> : <icons.enterFullscreen data-icon="inline-start" aria-hidden="true" />}</Toggle>}
          {(!compactHeader || headerStart) && onClose && <Button variant="ghost" size="icon-sm" className={compactHeader ? 'max-[641px]:hidden' : undefined} aria-label={labels.close} title={labels.close} data-testid={`${testId}-close`} onClick={() => run(onClose)}><icons.close data-icon="inline-start" aria-hidden="true" /></Button>}
        </div>
      </>;
  const header = <header ref={bar} data-testid={`${testId}-bar`} data-layout={stacked ? 'stacked' : undefined}
    className={cn('relative flex shrink-0', stacked ? 'flex-col' : 'h-13 flex-nowrap items-center gap-x-1.5 px-2 sm:px-3')}>
        {stacked ? <><div data-testid={`${testId}-titlebar`} className="flex min-h-14 min-w-0 items-center gap-x-1.5 px-3 py-1.5">{titlebar}</div>{toolbar}</> : titlebar}
        {notice && <Badge role="status" aria-live="polite" data-testid={`${testId}-notice`} data-tone={notice.tone} variant={notice.tone === 'danger' ? 'destructive' : 'secondary'}>{notice.text}</Badge>}
        {manual && <ManualCopy testId={testId} link={manual.link} text={manual.text} labels={labels} onClose={() => setManual(undefined)} />}
      </header>;
  return <ViewerBarContext.Provider value={space}>
    <section data-boring="viewer-frame" data-testid={`${testId}-frame`} data-tight={space.tight || undefined}
      className={cn('boring-viewer isolate flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground', className)}>
      {host?.renderHeader ? host.renderHeader(header) : header}
      <div data-testid={`${testId}-body`} className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </section>
  </ViewerBarContext.Provider>;
}
