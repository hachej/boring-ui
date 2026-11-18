'use client';

// The standalone entry of the one composer: a page with no `AppShell` (an existing site) mounts the same bar, floating over the page or folded to its icon, with the same strip, the same
// conversation levels, the unread mark and the needs-you ring. What `AmbientChat` does today, on the shell's composer. No side dock, no right pane: the conversation opens as the window above
// the bar, or full screen; on a phone it is the bottom sheet. Props are the agent and its words; nothing else is configurable. Host concern: Pi has no layout.
import type { ReactElement } from 'react';
import { AgentLayer, AgentLayerProvider } from './agent-layer';
import type { AgentSpec } from './agent-layer';
import { BarBox } from './agent-placements';
import { useInternal } from './layer-context';
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
}

function Surface(): ReactElement {
  const layer = useInternal();
  return <div className="app-shell contents">
    {layer.contentComposer && <BarBox standalone />}
    <AgentLayer />
  </div>;
}

/** The one composer on a page that has no AppShell. Mount it once, anywhere: it positions itself over the page. */
export function FloatingComposer({ agent, locale, appId, person, start = 'float' }: FloatingComposerProps): ReactElement {
  return <AgentLayerProvider agent={agent} composer="bar" floating docks={false} agentLink={false} {...(locale ? { locale } : {})} startIn={start} modeIdentity={{ ...(appId ? { app: appId } : {}), ...(person ? { person } : {}) }}>
    <Surface />
  </AgentLayerProvider>;
}
