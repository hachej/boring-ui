'use client';

// The standalone entry of the one composer: a page with no `AppShell` (an existing site) mounts the same bar, floating over the page or folded to its icon, with the same strip, the same
// conversation levels, the unread mark and the needs-you ring. What `AmbientChat` does today, on the shell's composer. No side dock, no right pane: the conversation opens as the window above
// the bar, or full screen; on a phone it is the bottom sheet. Props are the agent and its words; nothing else is configurable. Host concern: Pi has no layout.
import type { ReactElement, ReactNode } from 'react';
import { usePhone } from '../utils/use-media';
import { AgentLayer, AgentLayerProvider } from './agent-layer';
import type { AgentLayerApi, AgentSpec } from './layer-context';
import { NoticeSlotContext } from './float-composer';
import { BarBox } from './agent-placements';
import { shellWords, useInternal } from './layer-context';
import { NoticeHost } from './shell-notice';
import type { AppShellNotice } from './shell-notice';
import type { AppShellLocale } from './text';

export interface FloatingComposerProps {
  /** The one assistant: the same `AgentSpec` as `AppShell`'s `agent`. */
  readonly agent: AgentSpec;
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
  /** Rendered inside the composer's layer, so it can read `useAgentLayer()` (a host bridge that mirrors the place and the open conversation). Draws nothing of its own. */
  readonly children?: ReactNode;
}

const NONE: readonly AppShellNotice[] = [];

function Surface({ notices: given = NONE }: { readonly notices?: FloatingComposerProps['notices'] }): ReactElement {
  const layer = useInternal();
  const phone = usePhone();
  const notices = typeof given === 'function' ? given(layer) : given;
  const host = notices.length ? <NoticeHost notices={notices} text={shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent)} compact={phone} /> : null;
  return <NoticeSlotContext.Provider value={phone ? null : host}>
    <div className="app-shell contents">
      {layer.contentComposer && <BarBox standalone />}
      {/* A phone has no floating frame: the notice stands on the foot of the screen (`NoticeHost` lifts itself over the peek). */}
      {phone && host && <div data-testid="composer-notices" className="fixed inset-x-0 bottom-0 z-(--app-shell-z-layer)">{host}</div>}
      <AgentLayer />
    </div>
  </NoticeSlotContext.Provider>;
}

/** The one composer on a page that has no AppShell. Mount it once, anywhere: it positions itself over the page. */
export function FloatingComposer({ agent, locale, appId, person, start = 'float', notices, children }: FloatingComposerProps): ReactElement {
  return <AgentLayerProvider agent={agent} composer="bar" floating docks={false} agentLink={false} {...(locale ? { locale } : {})} startIn={start} modeIdentity={{ ...(appId ? { app: appId } : {}), ...(person ? { person } : {}) }}>
    {children}
    <Surface notices={notices} />
  </AgentLayerProvider>;
}
