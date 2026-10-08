'use client';

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { Button, IconButton } from '../button/button';
import { ActionButton, actionMenuItem, headerActions, menuActions } from '../button/actions';
import type { BlockAction } from '../button/actions';
import { ViewerMenu } from './menu';
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
/** `kind` says what the status is whatever its (translated) label: the bar hides a plain `saved` and shows `read-only` as a fact. */
export interface ViewerStatus { readonly label: string; readonly tone?: ViewerTone; readonly kind?: 'saved' | 'read-only' | undefined }

export interface ViewerFrameProps {
  /** What is shown, for example the file name. */
  readonly title: string;
  /** Type, version, path, size: short facts under the title. */
  readonly subtitle?: ReactNode;
  /** Saved, Unsaved, Saving, Changed elsewhere, Read-only. */
  readonly status?: ViewerStatus | undefined;
  /** Opaque identifiers handed to `onShare` so the host can build a link to this exact thing. */
  readonly target?: unknown;
  readonly revision?: string | undefined;
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
  readonly className?: string;
  readonly children?: ReactNode;
}


const TONES: Record<ViewerTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  danger: 'bg-destructive/12 text-destructive',
};
const DOTS: Record<ViewerTone, string> = {
  neutral: 'bg-muted-foreground/60',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-destructive',
};
/** Buttons are 40-44px on a phone or touch screen (see Button), 32px with a mouse: below this width a pane drops its optional bar controls. */
const TIGHT_WIDTH = { touch: 440, pointer: 340 };
const touchScreen = () => typeof matchMedia === 'function' && matchMedia('(max-width: 639px), (pointer: coarse)').matches;

/** How much room the bar has, for a pane that wants to drop optional controls (the zoom percentage, for example) on a narrow panel. */
export interface ViewerBarSpace { readonly tight: boolean }
const ViewerBarContext = createContext<ViewerBarSpace>({ tight: false });
export const useViewerBar = (): ViewerBarSpace => useContext(ViewerBarContext);
const NOTICE_MS = 2600;

/** A bar button: an icon with an accessible name and a tooltip. */
export const ViewerIconButton = IconButton;

/** One choice of a mode toggle, for example Rich | Source. Icon only: `label` is the accessible name and the tooltip, `text` the short word for hosts that want it. */
export interface ViewerToggleOption<T extends string> { readonly id: T; readonly label: string; readonly text: string; readonly icon?: ReactNode; readonly disabled?: boolean; readonly testId?: string }

export function ViewerToggle<T extends string>({ label, value, options, onChange }: { readonly label: string; readonly value: T; readonly options: readonly ViewerToggleOption<T>[]; readonly onChange: (id: T) => void }) {
  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  };
  return <div role="group" aria-label={label} onKeyDown={move} className="inline-flex shrink-0 rounded-lg border border-border bg-muted/40 p-0.5">
    {options.map(option => <button key={option.id} type="button" aria-label={option.label} title={option.label} aria-pressed={value === option.id} disabled={option.disabled}
      data-testid={option.testId} data-mode={option.id} onClick={() => onChange(option.id)}
      className={cn('inline-flex size-7 cursor-pointer items-center justify-center rounded-md outline-none max-sm:size-10 pointer-coarse:size-10 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45',
        value === option.id ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
      {option.icon ?? option.text}</button>)}
  </div>;
}

/** The copy helper throws this when the browser allowed no automatic copy at all; the person copies by hand instead. */
const needsManualCopy = (error: unknown): error is ManualCopyError => (error as { name?: string } | null)?.name === 'ManualCopyError' && typeof (error as { text?: unknown }).text === 'string';

/** Last resort for Copy and Share: the text, already selected, so Ctrl/Cmd+C or the long-press menu finishes the job. */
function ManualCopy({ testId, link, text, onClose, labels }: { readonly testId: string; readonly link: boolean; readonly text: string; readonly onClose: () => void; readonly labels: ViewerLabels }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();
  useEffect(() => { const element = field.current; if (element) { element.focus(); element.select(); } }, [text]);
  return <div role="dialog" aria-labelledby={labelId} data-testid={`${testId}-manual-copy`}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
    className="absolute top-full right-3 left-3 z-50 mt-1 grid gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg sm:left-auto sm:w-96">
    <p id={labelId} className="m-0 text-xs font-medium">{labels.manualCopy(link)}</p>
    <textarea ref={field} readOnly rows={Math.min(6, Math.max(2, Math.ceil(text.length / 48)))} value={text} data-testid={`${testId}-manual-copy-text`} onFocus={event => event.currentTarget.select()}
      className="w-full resize-none rounded-md border border-border bg-background p-2 font-mono text-xs break-all outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
    <div className="flex justify-end"><Button variant="quiet" size="bar" data-testid={`${testId}-manual-copy-close`} onClick={onClose}>{labels.done}</Button></div>
  </div>;
}

/** The status as a small dot with the words in a tooltip and for screen readers. The frame shows it only when the state is not plain "Saved". */
function StatusMark({ status, testId }: { readonly status: ViewerStatus; readonly testId: string }) {
  const tone = status.tone ?? 'neutral';
  return <span role="status" data-testid={`${testId}-status`} data-tone={tone} title={status.label} className="inline-flex size-6 shrink-0 cursor-default items-center justify-center rounded-full">
    <span aria-hidden="true" className={cn('size-2 rounded-full', DOTS[tone], tone === 'warning' && status.label !== 'Unsaved' && 'animate-pulse motion-reduce:animate-none')} />
    <span className="sr-only">{status.label}</span>
  </span>;
}

/** The one top bar of every viewer, always a single row: title and facts, viewer controls, a status dot when something needs attention, Share, full screen, Close and the "…" menu. */
export function ViewerFrame({ title, subtitle, status, target, revision, controls, menu, actions, labels: ownLabels, icons: ownIcons, onRefresh, onShare, onCopy, onDownload, onOpenInNewTab, onClose, testId = 'viewer', titleTestId, className, children }: ViewerFrameProps) {
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
  }, []);
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
    ...(onRefresh ? [{ id: 'refresh', label: labels.reload, icon: <RefreshCwIcon className="size-4" />, disabled: busy === 'refresh', onSelect: refresh }] : []),
    ...(onCopy ? [{ id: 'copy', label: labels.copy, icon: copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />, onSelect: copy }] : []),
    ...(onDownload ? [{ id: 'download', label: labels.download, icon: <DownloadIcon className="size-4" />, onSelect: () => run(onDownload) }] : []),
    ...(onOpenInNewTab ? [{ id: 'open', label: labels.openInNewTab, icon: <ExternalLinkIcon className="size-4" />, onSelect: () => run(onOpenInNewTab) }] : []),
    ...(menu ?? []),
    ...menuActions(hostActions).map(action => actionMenuItem(action, testId)),
  ] as ViewerMenuItem[]).map(entry => ({ ...entry, testId: entry.testId ?? `${testId}-${entry.id}` }));

  return <ViewerBarContext.Provider value={space}>
    <section data-boring="viewer-frame" data-testid={`${testId}-frame`} data-tight={space.tight || undefined}
      className={cn('boring-viewer flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground', className)}>
      <header ref={bar} data-testid={`${testId}-bar`} className="relative flex shrink-0 flex-nowrap items-center gap-x-1.5 border-b border-border px-3 py-1.5">
        <div className="min-w-0 flex-1 basis-0">
          <h2 data-testid={titleTestId ?? `${testId}-title`} title={title} className="m-0 truncate text-sm leading-5 font-semibold tracking-tight">{title}</h2>
          {(subtitle || reading) && <p data-testid={`${testId}-subtitle`} className="m-0 flex min-w-0 items-center gap-x-1.5 overflow-hidden text-xs leading-4 whitespace-nowrap text-muted-foreground">{subtitle}{subtitle && reading && <span aria-hidden="true">·</span>}{reading && <span data-testid={`${testId}-readonly`}>{labels.readOnly}</span>}</p>}
        </div>
        {controls && <div data-testid={`${testId}-controls`} className="flex shrink-0 items-center gap-1">{controls}</div>}
        {status && !reading && status.kind !== 'saved' && status.label !== labels.saved && <StatusMark status={status} testId={testId} />}
        <div className="flex shrink-0 items-center gap-0.5">
          {headerActions(hostActions).map(action => <ActionButton key={action.id} action={action} testId={testId} size="icon-bar" />)}
          {onShare && <ViewerIconButton label={labels.share} data-testid={`${testId}-share`} disabled={busy === 'share'} onClick={share}><icons.share className="size-4" aria-hidden="true" /></ViewerIconButton>}
          {menuItems.length > 0 && <ViewerMenu label={labels.moreActions} testId={`${testId}-more`} icon={<icons.more className="size-4" aria-hidden="true" />} items={menuItems} />}
          {host?.onFullscreenChange && <ViewerIconButton label={host.fullscreen ? labels.exitFullscreen : labels.enterFullscreen} data-testid={`${testId}-fullscreen`} aria-pressed={host.fullscreen === true}
            onClick={() => host.onFullscreenChange!(!host.fullscreen)}>{host.fullscreen ? <icons.exitFullscreen className="size-4" aria-hidden="true" /> : <icons.enterFullscreen className="size-4" aria-hidden="true" />}</ViewerIconButton>}
          {onClose && <ViewerIconButton label={labels.close} data-testid={`${testId}-close`} onClick={() => run(onClose)}><icons.close className="size-4" aria-hidden="true" /></ViewerIconButton>}
        </div>
        {notice && <span role="status" aria-live="polite" data-testid={`${testId}-notice`} data-tone={notice.tone} className={cn('absolute top-full right-3 z-40 mt-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium shadow-md', TONES[notice.tone])}>{notice.text}</span>}
        {manual && <ManualCopy testId={testId} link={manual.link} text={manual.text} labels={labels} onClose={() => setManual(undefined)} />}
      </header>
      <div data-testid={`${testId}-body`} className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </section>
  </ViewerBarContext.Provider>;
}
