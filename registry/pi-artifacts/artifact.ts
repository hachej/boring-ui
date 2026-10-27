import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ComponentType, ReactNode } from 'react';
import { defaultChatLabels } from '../pi-chat/labels';
import type { ChatArtifactsConfig } from '../pi-chat/config';

// Compatibility exports for one release; conversation rules live in the kit.
export { ARTIFACT_TYPES, PRESENT_TOOL, artifactKey, parseArtifact, detectArtifact, collectArtifacts, pendingPresents, presentPath, pendingTitle, pendingId, createPresentAcks, recogniseArtifact } from '@hachej/boring-ui-kit/chat-view';
export type { ArtifactType, ArtifactTarget, ArtifactDescriptor, PendingPresent, PresentAnswer, PresentAcksHost, PresentContext, PresentAcks } from '@hachej/boring-ui-kit/chat-view';
import type { ArtifactDescriptor, ArtifactTarget, ArtifactType } from '@hachej/boring-ui-kit/chat-view';

/**
 * What an artifact kind's renderer receives: the artifact and its text at the revision shown, the page's URL fragment without `#`
 * (a link such as `#screen=2` can open a place inside the artifact; the panel follows its changes), and `read`: another file of the same
 * workspace as text (its latest revision; undefined when it is missing or not text), for an artifact that links to a file. `revision` is
 * the shown revision, the one a conditional save is made against; `pinned` is true when the panel shows a pinned historical version,
 * which is read-only.
 */
export interface ArtifactKindViewProps {
  readonly artifact: ArtifactDescriptor;
  readonly text: string;
  readonly revision: string;
  readonly pinned: boolean;
  /**
   * The view is loaded and on screen. A kind with `waitsForReady` must call it (once per revision shown): only then does the page
   * acknowledge a `present` call for this file. Other kinds are acknowledged as soon as their file is read, and may ignore it.
   */
  readonly onReady?: (() => void) | undefined;
  /**
   * The view could not be shown (its data failed to load, for example), with a short reason for the agent (at most 200 characters are
   * sent). A `present` call waiting for this file is refused with that reason. A renderer that throws is reported the same way.
   */
  readonly onFailed?: ((reason: string) => void) | undefined;
  readonly fragment?: string | undefined;
  readonly read?: ((path: string) => Promise<string | undefined>) | undefined;
  /**
   * The panel's bar owns the one "…" menu: a view publishes its own entries there (a maquette's guided tours) and clears them with `[]`.
   * Absent outside the panel; the view then draws its own menu.
   */
  readonly setMenu?: ((items: readonly ArtifactMenuEntry[]) => void) | undefined;
  /** The panel bar's controls slot: a view puts its own controls there (the SVG preview and source toggle) and clears them with undefined. */
  readonly setControls?: ((controls: ReactNode) => void) | undefined;
}

/** One entry a kind's view adds to the panel bar's "…" menu (structurally the viewer frame's menu item). */
export interface ArtifactMenuEntry { readonly id: string; readonly label: string; readonly icon: ReactNode; readonly testId: string; readonly separatorBefore: boolean; readonly onSelect: () => void }

/** What a kind's `load` resolves to: a module whose default export is the view. */
export type ArtifactKindView = { readonly default: ComponentType<ArtifactKindViewProps> };

/**
 * An app's own kind of artifact (for example `.maquette.json` files): how its card and the panel name it, its icon, and optionally
 * how the panel draws it. Kinds are consulted in order before the built-in types; the first whose `match` is true wins. A kind
 * adds a presentation only: the descriptor, its type and how it is read are unchanged.
 */
export interface ArtifactKind {
  /** True for the artifacts of this kind, for example `target => target.resource.path.endsWith('.maquette.json')`. */
  readonly match: (target: ArtifactTarget, artifact: ArtifactDescriptor) => boolean;
  /** The kind's name on the card and in the panel bar ("Maquette"). The type's name otherwise. */
  readonly label?: string | undefined;
  /** The card's icon (any component taking `className`, such as a lucide icon). The type's icon otherwise. */
  readonly icon?: ComponentType<{ readonly className?: string; readonly 'aria-hidden'?: boolean | 'true' }> | undefined;
  /** Draws the artifact in the panel (`AgentWorkspace`, `ArtifactPanel`) inside the standard viewer bar, with copy and download. */
  readonly renderer?: ((props: ArtifactKindViewProps) => ReactNode) | undefined;
  /**
   * The view's module, loaded the first time an artifact of this kind opens: the panel wraps it once per kind in `React.lazy` with a
   * spinner in the bar, so the view's code (and its libraries) is not in the page's first bundle. Same props and bar as `renderer`; a kind
   * with both draws with `renderer`. Write it as `() => import('./my-view')` so a bundler splits the view into its own chunk.
   */
  readonly load?: (() => Promise<ArtifactKindView>) | undefined;
  /**
   * A default viewer for a whole type or media type (the built-in Markdown, HTML, SVG, CSV, image and PDF kinds): a host's `viewers`
   * entry for that type wins over it, as it did over the built-in viewers.
   */
  readonly fallback?: boolean | undefined;
  /**
   * The renderer loads asynchronously (a dashboard fetching its data, a sandboxed frame): the panel confirms a `present` of this file
   * only after the renderer calls `onReady`, and refuses it when it calls `onFailed` or throws. With no call, the call ends unconfirmed.
   */
  readonly waitsForReady?: boolean | undefined;
}

/** What every kind shares, whatever its view: the match, its name and icon. The panel's Markdown and HTML editor kinds are kinds too. */
export type KindMatch = Pick<ArtifactKind, 'match' | 'label' | 'icon'>;

/** The first kind that matches the artifact; a `match` that throws counts as no match. */
export function artifactKind<Kind extends KindMatch>(artifact: ArtifactDescriptor, kinds: readonly Kind[] | undefined): Kind | undefined {
  return kinds?.find(kind => { try { return kind.match(artifact.target, artifact); } catch { return false; } });
}

/** What the host passes to `PiChat` to turn artifact tool results into cards. */
export interface ArtifactsConfig {
  /** The app's own artifact kinds (label, icon, renderer), consulted before the built-in types. */
  readonly kinds?: readonly KindMatch[] | undefined;
  /** The person clicked a card: show this artifact (and revision) in the host's panel. */
  readonly open: (artifact: ArtifactDescriptor) => void;
  /** True for the card whose artifact version is on display. */
  readonly isOpen?: (artifact: ArtifactDescriptor) => boolean;
  /** Recognise a descriptor in a successful tool result that does not carry one itself (for example a document save). */
  readonly detect?: (call: ToolCall, result: ToolResultMessage) => ArtifactDescriptor | undefined;
  /** How the chat finds a call's artifact (`recogniseArtifact`). With `Card`, it is what makes `PiChat` offer artifacts; `artifactCards` sets both. */
  readonly recognise?: ChatArtifactsConfig['recognise'];
  /** The card the chat draws (`PluggedArtifactCard`). */
  readonly Card?: ChatArtifactsConfig['Card'];
}

/** The artifact's type name: the matching kind's label first, then the chat's name of its type. */
export function typeLabel(artifact: ArtifactDescriptor, kinds?: readonly KindMatch[], labels: Readonly<Record<ArtifactType, string>> = defaultChatLabels.artifactTypes): string {
  const kind = artifactKind(artifact, kinds);
  if (kind?.label) return kind.label;
  return artifact.type === 'code' && artifact.language ? `${labels.code} · ${artifact.language}` : labels[artifact.type];
}
