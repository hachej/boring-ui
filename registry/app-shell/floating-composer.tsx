'use client';

// The standalone entry of the one composer: a page with no `AppShell` (an existing site) mounts the same bar, floating over the page or folded to its icon, with the same strip, the same
// conversation levels, the unread mark and the needs-you ring. What `AmbientChat` does today, on the shell's composer. No side dock, no right pane: the conversation opens as the window above
// the bar, or full screen; on a phone it is the bottom sheet. Props are the agent and its words; nothing else is configurable. Host concern: Pi has no layout.
import type { ReactElement, ReactNode } from 'react';
import { usePhone } from '../utils/use-media';
import { AgentLayer, AgentLayerProvider } from './agent-layer';
import type { AgentLayerApi, AgentSpec } from './layer-context';
import { ComposerClassContext, NoticeSlotContext } from './float-composer';
import { BarBox } from './agent-placements';
import { shellWords, useInternal } from './layer-context';
import type { ComposerConfig, ComposerEnv } from './composer-config';
import { useComposerInput } from './composer-input';
import { NoticeHost } from './shell-notice';
import { EmbeddedConversation, useHostedSpec } from './floating-host';
import type { FloatingHostProps } from './floating-host';
import { FloatPane } from './float-pane';
import type { AppShellNotice } from './shell-notice';
import type { AppShellLocale } from './text';
import type { Persistence } from '../utils/persisted';

export interface FloatingComposerProps extends FloatingHostProps {
  /** The one assistant: the same `AgentSpec` as `AppShell`'s `agent`. */
  readonly agent: AgentSpec;
  /**
   * The composer's config (`ComposerConfig`), or a function of `{ phone, width, route }` that gives it: `{ launcher: 'circle', handoff: { openFull } }` is a round launcher that opens one panel
   * and hands the conversation to the app's full page; `{ launcher: 'bar', fold: 'circle', float: { movable: true } }` is the bar this component draws by default. The object replaces `start`, `storage` and `onOpenFull`: given with it, they throw.
   */
  readonly composer?: ComposerConfig | ((env: ComposerEnv) => ComposerConfig) | undefined;
  /** The language of the composer's own words (default: the agent's `chatProps.locale`, then English). */
  readonly locale?: AppShellLocale;
  /** A stable id of the host site and, when known, the person: the place and the floating or folded choice are remembered per app and person. */
  readonly appId?: string;
  readonly person?: string;
  /** Where it starts when nothing is remembered: `float` (default) or `icon`. A phone keeps the bar at the bottom (or the icon). */
  readonly start?: 'float' | 'icon';
  /**
   * Things to tell the person, newest first: the shell's `notices` (one at a time, the others behind it as « N more waiting »), drawn above the floating bar (below it from a top corner),
   * above the folded icon and above the bottom bar, and above the field on a phone. Absent: none. A function gets the layer's api, so a notice's action can open the conversation or bring the icon back.
   */
  readonly notices?: readonly AppShellNotice[] | ((layer: Omit<AgentLayerApi, 'agent'>) => readonly AppShellNotice[]) | undefined;
  /** Where the place (floating, folded, the corner or free position) is remembered: `local` (default, kept across visits) or `session` (this browser tab only). */
  readonly storage?: Persistence;
  /** The key the old floating bar (`AmbientChat`) kept its dragged position under (`{ right, bottom }`). With no place of its own yet, the composer starts where that was, once: nothing is lost on an upgrade. Read from `legacyPositionStorage` (default `session`, as the old bar). */
  readonly legacyPositionKey?: string;
  readonly legacyPositionStorage?: Persistence;
  /** Classes for the composer's own box (the floating frame, the folded icon, the bottom bar of a wide window; a phone's bottom sheet is the shell's own), so a host can move or size it. */
  readonly className?: string;
  /** How long a notice stays before it fades, in ms; `0` keeps it until dismissed. Applies to every kind but a warning (a decision waits). Default: info and success fade after 8 s, errors stay. */
  readonly autoDismissMs?: number;
  /** The most notices kept (one shows at a time, the others wait behind it as « N more »): the oldest info and success go first, a warning or an error is never dropped. Default 5. */
  readonly maxToasts?: number;
  /** Rendered inside the composer's layer, so it can read `useAgentLayer()` (a host bridge that mirrors the place and the open conversation). Draws nothing of its own. */
  readonly children?: ReactNode;
}

const NONE: readonly AppShellNotice[] = [];
const NO_LEGACY: readonly string[] = [];

function Surface({ notices: given = NONE, autoDismissMs, maxToasts }: { readonly notices?: FloatingComposerProps['notices']; readonly autoDismissMs?: number | undefined; readonly maxToasts?: number | undefined }): ReactElement {
  const layer = useInternal();
  const phone = usePhone();
  const notices = typeof given === 'function' ? given(layer) : given;
  const host = notices.length ? <NoticeHost notices={notices} text={shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent)} compact={phone} fadeMs={autoDismissMs} max={maxToasts} /> : null;
  return <NoticeSlotContext.Provider value={phone ? null : host}>
    <div className="app-shell contents">
      {layer.contentComposer && <BarBox standalone />}
      {/* A phone has no floating frame: the notice stands on the foot of the screen (`NoticeHost` lifts itself over the peek). */}
      {phone && host && <div data-testid="composer-notices" className="fixed inset-x-0 bottom-0 z-(--z-app-shell-layer)">{host}</div>}
      <AgentLayer />
      {/* Wide: the pane's entries (an artifact, a file, an app view) open in a window beside the bar; a phone shows them full screen (`AgentLayer`). */}
      {!phone && <FloatPane />}
    </div>
  </NoticeSlotContext.Provider>;
}

/** The one composer on a page that has no AppShell. Mount it once, anywhere: it positions itself over the page. */
export function FloatingComposer({ agent, composer, locale, appId, person, start, notices, storage, legacyPositionKey, legacyPositionStorage = 'session', className, autoDismissMs, maxToasts, children, embedded, headerTools, headerActions, onDock, onOpenFull, onFeedback, artifactPanel, artifacts, artifactTarget }: FloatingComposerProps): ReactElement {
  const resolved = useComposerInput(composer);
  const config = typeof resolved === 'object' ? resolved : undefined;
  // The object replaces the props it makes second sources; the resolver throws when it is given next to them.
  const legacy = config ? [['start', start], ['storage', storage], ['onOpenFull', onOpenFull]].flatMap(([name, value]) => value === undefined ? [] : [name as string]) : NO_LEGACY;
  const spec = useHostedSpec(agent, { locale, headerTools, headerActions, onDock, onOpenFull, onFeedback, artifactPanel, artifacts, artifactTarget });
  if (embedded) return <EmbeddedConversation agent={spec} locale={locale} />;
  const remember = config?.at?.remember === undefined ? undefined : config.at.remember === 'local' ? 'local' : 'session';
  return <AgentLayerProvider agent={spec} composer={config ?? 'bar'} floating={config === undefined} standalone legacy={legacy} docks={false} agentLink={false} {...(locale ? { locale } : {})} startIn={start ?? 'float'} storage={storage ?? remember ?? 'local'} modeIdentity={{ ...(appId ? { app: appId } : {}), ...(person ? { person } : {}) }}
    {...(legacyPositionKey ? { legacyPosition: { key: legacyPositionKey, storage: legacyPositionStorage } } : {})}>
    {children}
    <ComposerClassContext.Provider value={className}><Surface notices={notices} autoDismissMs={autoDismissMs} maxToasts={maxToasts} /></ComposerClassContext.Provider>
  </AgentLayerProvider>;
}
