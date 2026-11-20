'use client';

// Notices at the composer (`AppShell notices`, and the `update` notice drawn through the same component). ONE notice shows at a time, above the bar in the screen
// column, in the flow above the phone's tab bar (it takes room, so it never covers the screen's last control); the others wait behind it with a count and the next
// shows when this one goes. A notice takes no focus, never opens the conversation and is announced politely. Info and success fade after 8 s unless hovered or focused;
// warnings and errors stay until dismissed. Host concern: Pi has no layout; the platform decides what is worth a notice, the kit only draws it.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AtIcon, CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from '../_shared/icons';
import { cn } from '../utils/utils';
import { useInternal } from './layer-context';
import type { AppShellText } from './text';

export interface AppShellNotice {
  /** Stable per notice: a dismiss holds for this id, and a list that no longer has it forgets the dismiss. */
  readonly id: string;
  readonly kind: 'info' | 'success' | 'warning' | 'error';
  readonly text: string;
  /** One action in place. The host removes the notice when it is done (a notice that stays shows the next one only when it is dismissed). */
  readonly action?: { readonly label: string; readonly onSelect: () => void };
  /** The person dismissed it, or it faded. The shell hides it at once either way; a host that owns the list drops it here. */
  readonly onDismiss?: () => void;
  /** Warning and error only: a mention token (`talkAbout`) that puts this notice in the assistant's field, as a table row does. Shown when the agent's chat has `mentions`. */
  readonly reference?: string;
  /** Set by the shell for its own update notice: it stays until dismissed, has its own names, and says which version it is for. */
  readonly own?: { readonly version: string | undefined; readonly dismissLabel: string; readonly ids: { readonly root: string; readonly text: string; readonly action: string; readonly dismiss: string } };
}

const FADE_MS = 8000;
const MAX_QUEUED = 5;
const SWIPE = 48;
const droppable = (notice: AppShellNotice) => notice.kind === 'info' || notice.kind === 'success';
const fades = (notice: AppShellNotice) => droppable(notice) && !notice.own;
/** How long a notice stays before it fades: `fadeMs` (0 = stays) for every kind but a warning, else 8 s for info and success and no fade for the others. Undefined: it stays. */
const fadeAfter = (notice: AppShellNotice, fadeMs: number | undefined): number | undefined =>
  notice.own ? undefined : fadeMs === undefined ? fades(notice) ? FADE_MS : undefined : notice.kind === 'warning' || fadeMs <= 0 ? undefined : fadeMs;

/** At most `MAX_QUEUED`: past that the oldest (last) info or success notices go, one at a time; a warning or an error is never dropped. */
export function capNotices(list: readonly AppShellNotice[], max = MAX_QUEUED): readonly AppShellNotice[] {
  const kept = [...list];
  for (let at = kept.findLastIndex(droppable); kept.length > max && at >= 0; at = kept.findLastIndex(droppable)) kept.splice(at, 1);
  return kept;
}

const TONES = {
  info: { icon: InfoIcon, box: '', mark: '' },
  success: { icon: CircleCheckIcon, box: 'border-success bg-success-soft', mark: 'text-success-soft-foreground' },
  warning: { icon: TriangleAlertIcon, box: 'border-warning bg-warning-soft', mark: 'text-warning-soft-foreground' },
  error: { icon: CircleAlertIcon, box: 'border-destructive bg-destructive-soft', mark: 'text-destructive-soft-foreground' },
} as const;

/** Notices as the shell shows them: the host's, then the update's. `notices` is newest first. Renders at most one. */
export function NoticeHost({ notices, text, compact, fadeMs, max, reserve = false }: { readonly notices: readonly AppShellNotice[]; readonly text: AppShellText; readonly compact: boolean; readonly fadeMs?: number | undefined; readonly max?: number | undefined; /** The shell's row at the foot of the screen: a circle launcher's footprint (`--composer-reserve-inline`) is kept free at its end, so the row never runs under the circle. */ readonly reserve?: boolean }): ReactNode {
  // Read here, not in the shell: only a shell with notices follows the layer's snaps (a shell that reads the layer re-renders its screens with it).
  const layer = useInternal();
  const [gone, setGone] = useState<readonly string[]>([]);
  const [held, setHeld] = useState(false);
  const [press, setPress] = useState<{ readonly x: number; readonly y: number } | undefined>();
  const queue = capNotices(notices, max).filter(notice => !gone.includes(notice.id));
  const shown = queue[0];
  // A dismiss ends with the notice leaving the list: the same id may come back and show again. Reset while rendering, not in an effect.
  if (gone.some(id => !notices.some(notice => notice.id === id))) setGone(gone.filter(id => notices.some(notice => notice.id === id)));
  const dismiss = () => { if (!shown) return; setGone(ids => [...ids, shown.id]); setHeld(false); shown.onDismiss?.(); };
  const fadeIn = shown === undefined ? undefined : fadeAfter(shown, fadeMs);
  const fading = fadeIn !== undefined;
  const latest = useRef(shown);
  useEffect(() => { latest.current = shown; });
  const shownId = shown?.id;
  useEffect(() => {
    if (shownId === undefined || !fading || held) return;
    const timer = setTimeout(() => { setGone(ids => [...ids, shownId]); latest.current?.onDismiss?.(); }, fadeIn);
    return () => clearTimeout(timer);
  }, [shownId, fading, fadeIn, held]);
  if (!shown) return null;
  const { icon: Icon, box, mark } = TONES[shown.kind];
  const ids = shown.own?.ids ?? { root: 'notice', text: 'notice-text', action: 'notice-action', dismiss: 'notice-dismiss' };
  // A phone's peek (the one composer's field, or a parked drawer) sits over the foot of the screen, above the tabs: the notice rises above it.
  const lift = compact && layer.snap === 'peek' ? `calc(${layer.peekPoint} - ${layer.tabbar}px)` : undefined;
  const mentions = layer.agent?.chatProps?.mentions !== undefined;
  const touch = 'max-md:min-h-11 pointer-coarse:min-h-11';
  return <div data-testid={ids.root} data-notice-kind={shown.kind} data-version={shown.own?.version} data-feedback-ignore="" style={lift || (reserve && layer.circle) ? { ...(lift ? { marginBottom: lift } : {}), ...(reserve && layer.circle ? { paddingInlineEnd: 'max(var(--screen-gutter, 1rem), calc(var(--composer-reserve-inline, 0px) + 0.5rem))' } : {}) } : undefined} className="shrink-0 touch-pan-y px-[var(--screen-gutter,1rem)] py-2"
    onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}
    onPointerDown={event => { if (event.pointerType !== 'mouse') setPress({ x: event.clientX, y: event.clientY }); }}
    onPointerUp={event => { const start = press; setPress(undefined); if (start && event.clientX - start.x <= -SWIPE && Math.abs(event.clientY - start.y) < SWIPE / 2) dismiss(); }} onPointerCancel={() => setPress(undefined)}>
    {/* The default Alert tinted by the kind: the kit's variants are not in every shadcn Alert, and `info` keeps the plain card the update notice always had. */}
    <Alert role="status" aria-live="polite" className={cn('flex items-center gap-2', box)}>
      <Icon className={mark} />
      <div className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-2">
        <span data-testid={ids.text} className="min-w-0 flex-1">{shown.text}</span>
        {queue.length > 1 && <span data-testid="notice-more" className="shrink-0 text-xs text-muted-foreground">{text.noticeMore.replace('{n}', String(queue.length - 1))}</span>}
      </div>
      {shown.reference && mentions && (shown.kind === 'warning' || shown.kind === 'error') && <Tooltip>
        <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" data-testid="notice-reference" aria-label={text.referenceInAgent} className={cn(touch, 'max-md:min-w-11 pointer-coarse:min-w-11')} onClick={() => layer.talkAbout(shown.reference!, { add: true })} />}><AtIcon aria-hidden="true" /></TooltipTrigger>
        <TooltipContent side="top">{text.referenceInAgent}</TooltipContent>
      </Tooltip>}
      {shown.action && <Button variant="outline" size="sm" data-testid={ids.action} className={touch} onClick={shown.action.onSelect}>{shown.action.label}</Button>}
      <Button variant="ghost" size="icon-sm" data-testid={ids.dismiss} aria-label={shown.own?.dismissLabel ?? text.noticeDismiss} className={cn(touch, 'max-md:min-w-11 pointer-coarse:min-w-11')} onClick={dismiss}><XIcon /></Button>
    </Alert>
  </div>;
}
