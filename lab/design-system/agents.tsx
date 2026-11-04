/*
 * Real chat and agent layouts over the gallery's mock providers (mock.tsx). The demos that read the viewport (dock, phone drawer,
 * workspace, floating chat) or open a positioned menu are rendered alone in an `Embed` frame; the others render inline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PiChat } from '../../registry/pi-chat/pi-chat';
import type { PiChatProps } from '../../registry/pi-chat/pi-chat';
import { markdownText } from '../../registry/pi-chat-markdown/markdown';
import { SlashPicker } from '../../registry/pi-chat-slash/slash-menu';
import { MentionPicker } from '../../registry/pi-chat-mentions/mention-menu';
import { ModelEffortPicker } from '../../registry/pi-chat-pickers/pickers';
import { AppShell } from '../../registry/app-shell/app-shell';
import { useAgentLayer } from '../../registry/app-shell/agent-layer';
import { AgentTargetMode } from '../../registry/agent-target/agent-target';
import { agentTargetLabelsFr } from '../../registry/agent-target/agent-target-labels';
import { AgentWorkspace } from '../../registry/pi-app/agent-workspace';
import { Dock, DockLayout, DockMain } from '../../registry/dock/dock';
import { AmbientChat } from '../../registry/pi-ambient/ambient';
import { TaskListViewer } from '../../registry/task-list-viewer/task-list-viewer';
import { MaquetteViewer } from '../../registry/maquette-viewer/maquette-viewer';
import { Inbox } from '../../registry/_shared/icons';
import { isDark, setDark, useLocale } from './kit';
import { BoardViewer } from '../../registry/board-viewer/board-viewer';
import { selfHostedCanvasAssetUrls } from '../../examples/canvas-assets/self-hosted.mjs';
import boardJson from '../../test/fixtures/board/booking.board.json';
import boardMaquetteJson from '../../test/fixtures/board/booking.maquette.json';
import boardMockup from '../../test/fixtures/board/confirm.mockup.html';
import iconSprite from '@tldraw/assets/icons/icon/0_merged.svg';
import { conversations, fakeChat, fileIdentity, locator, maquette, memoryClient, mentionSearch, models, slashCommands, slashSkills, suggestions, taskController } from './mock';
import type { ChatState } from './mock';

const noop = async () => undefined;
const boardText = JSON.stringify(boardJson), boardMaquette = JSON.stringify(boardMaquetteJson);
/** The page is one offline file, so the canvas's translations and icon sprite travel inline as data URLs (embed icons are blank and fonts fall back to the system stack). */
function inlineCanvasAssets() {
  const urls = selfHostedCanvasAssetUrls('./tldraw-assets');
  return { ...urls,
    translations: Object.fromEntries(Object.keys(urls.translations).map(key => [key, 'data:application/json,{}'])),
    icons: Object.fromEntries(Object.keys(urls.icons).map(name => [name, `${iconSprite}#${name}`])),
    embedIcons: Object.fromEntries(Object.keys(urls.embedIcons).map(type => [type, 'data:image/gif;base64,R0lGODlhAQABAAAAACw='])) };
}

/** The chat's host configuration, as an app passes it: Markdown replies, starters, `/` and `@` menus, the model pill and the history list. */
export function useChatProps(): Omit<PiChatProps, 'controller'> {
  const locale = useLocale();
  const [active, setActive] = useState<string>(conversations[0].id);
  return {
    locale, renderText: markdownText, suggestions,
    slash: { commands: slashCommands, skills: slashSkills, Picker: SlashPicker },
    mentions: { search: mentionSearch, listLabel: locale === 'fr' ? 'Fichiers' : 'Files', Picker: MentionPicker },
    model: { options: models, change: noop, Picker: ModelEffortPicker },
    effort: { options: ['bas', 'moyen', 'élevé'], change: noop },
    conversations: { items: conversations, activeId: active, onSelect: setActive, onNew: () => undefined },
  };
}

/** Types into the composer as a person does (a native input event), so the composer opens its own `/` or `@` menu. */
function typeInto(root: HTMLElement | null, text: string) {
  const input = root?.querySelector<HTMLTextAreaElement>('[data-testid=composer-input]');
  if (!input) return false;
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Runs `act` once the block has rendered (a few frames, as the chat mounts its parts lazily). */
function useAfterMount(act: (() => boolean) | undefined) {
  useEffect(() => {
    if (!act) return;
    let tries = 0;
    const timer = setInterval(() => { if (act() || ++tries > 40) clearInterval(timer); }, 100);
    return () => clearInterval(timer);
  }, [act]);
}

export type ChatAction = 'slash' | 'mention' | 'model' | 'history';
export function ChatDemo({ state, action, draft }: { readonly state: ChatState; readonly action?: ChatAction; readonly draft?: string }) {
  const controller = useMemo(() => fakeChat(state, draft ? { draft } : {}), [state, draft]);
  const props = useChatProps();
  const root = useRef<HTMLDivElement>(null);
  const act = useMemo(() => !action ? undefined : () => {
    if (action === 'slash') return typeInto(root.current, '/');
    if (action === 'mention') return typeInto(root.current, 'Relis @fact');
    const button = root.current?.querySelector<HTMLElement>(action === 'model' ? '[data-testid=composer-model]' : '[data-testid=history-open]');
    button?.click();
    return Boolean(button);
  }, [action]);
  useAfterMount(act);
  return <div ref={root} className="h-full min-h-0"><PiChat controller={controller} {...props} keyboardInset={false} /></div>;
}

/* ---------- shell with the agent ---------- */

const orders = [
  ['A-1041', 'Atelier Lumen', '1 204,50 €', 'Payée'],
  ['A-1042', 'Maison Orme', '388,00 €', 'En attente'],
  ['A-1043', 'Studio Vallon', '2 910,00 €', 'En retard'],
  ['A-1044', 'Boulangerie Ferrand', '640,00 €', 'Payée'],
] as const;

function OrdersPage({ open, target }: { readonly open?: 'peek' | 'half' | 'full'; readonly target?: boolean }) {
  const layer = useAgentLayer();
  const opened = useRef(false);
  useEffect(() => { if (open && !opened.current) { opened.current = true; layer.open('agent', open); } }, [layer, open]);
  return <div className="flex flex-col gap-2 p-3">
    <h3 className="text-[length:var(--text-title)] font-semibold">Commandes</h3>
    {target ? <AgentTargetMode enabled transcribe={async () => 'Relance ce client.'} onSettled={() => undefined} labels={agentTargetLabelsFr} /> : null}
    {orders.map(([id, client, total, status]) => <div key={id} data-agent-target={JSON.stringify({ order: id })}
      className="flex items-center gap-3 rounded-md bg-card px-3 py-2 text-xs tabular-nums">
      <span className="text-muted-foreground">{id}</span><span className="min-w-0 flex-1 truncate">{client}</span><span>{total}</span><span className="text-muted-foreground">{status}</span>
    </div>)}
  </div>;
}

export function AgentShell({ open, target, chat = 'populated' }: { readonly open?: 'peek' | 'half' | 'full'; readonly target?: boolean; readonly chat?: ChatState }) {
  const [route, setRoute] = useState('orders');
  const locale = useLocale();
  const controller = useMemo(() => fakeChat(chat), [chat]);
  const chatProps = useChatProps();
  const nav = [
    { id: 'orders', label: locale === 'fr' ? 'Commandes' : 'Orders', icon: Inbox, render: () => <OrdersPage {...(open ? { open } : {})} {...(target ? { target } : {})} /> },
    { id: 'clients', label: 'Clients', icon: Inbox, render: () => <OrdersPage /> },
  ];
  return <AppShell layout="screen" title="Atelier Lumen" nav={nav} route={{ id: route, onChange: setRoute }} locale={locale} agentLink={false}
    agent={{ controller: controller as never, label: 'Assistant', chatProps }}
    account={{ name: 'Camille Durand', email: 'camille@example.test', menu: [], theme: { value: isDark() ? 'dark' : 'light', onChange: value => setDark(value === 'dark') } }} />;
}

/* ---------- workspace (pi-app) and PM layout ---------- */

export function Workspace({ pm }: { readonly pm?: boolean }) {
  const controller = useMemo(() => fakeChat('populated'), []);
  const tasks = useMemo(() => taskController('populated'), []);
  const { conversations: list, ...chat } = useChatProps();
  const locale = useLocale();
  const panels: Record<string, () => ReactNode> = {
    tasks: () => <TaskListViewer controller={tasks} title="Tâches de la semaine 45" />,
    maquette: () => <MaquetteViewer text={maquette} path="maquettes/reservation.maquette.json" locale={locale} />,
  };
  return <AgentWorkspace layout="default" title="Atelier Lumen" controller={controller} conversationId="c-relances" conversations={list} chat={chat} locale={locale}
    storageKey={`gallery.workspace.${pm ? 'pm' : 'app'}`} defaultOpened={{ kind: pm ? 'maquette' : 'tasks' }} panels={panels} />;
}

/* ---------- detached: the same chat floats over the app ---------- */

export function Detached() {
  const controller = useMemo(() => fakeChat('populated'), []);
  return <DockLayout storageKey="gallery.detached" className="h-full">
    <Dock id="chat" side="left" floatable defaultPlacement="floating" dragBelow={260} narrowBelow={720}>
      {api => api.floating
        ? <AmbientChat controller={controller} variant="surface" defaultState="expanded" onDock={api.dock} />
        : <PiChat controller={controller} renderText={markdownText} />}
    </Dock>
    <DockMain><OrdersList /></DockMain>
  </DockLayout>;
}

function OrdersList() {
  return <div className="flex flex-col gap-2 p-3">
    <h3 className="text-[length:var(--text-title)] font-semibold">Commandes</h3>
    {orders.map(([id, client, total]) => <div key={id} className="flex gap-3 rounded-md bg-card px-3 py-2 text-xs tabular-nums"><span className="text-muted-foreground">{id}</span><span className="flex-1">{client}</span><span>{total}</span></div>)}
  </div>;
}

/* ---------- board ---------- */

export function BoardDemo() {
  const files = useMemo(() => ({
    'tableaux/reservation.board.json': { text: boardText, mediaType: 'application/json' },
    'tableaux/booking.maquette.json': { text: boardMaquette, mediaType: 'application/json' },
    'tableaux/confirm.mockup.html': { text: boardMockup, mediaType: 'text/html' },
  }), []);
  const client = useMemo(() => memoryClient(files), [files]);
  const target = useMemo(() => locator('tableaux/reservation.board.json'), []);
  return <div className="h-full"><BoardViewer client={client} identity={fileIdentity} assetUrls={inlineCanvasAssets() as never} target={target} text={boardText} revision="r1" pinned={false} /></div>;
}
