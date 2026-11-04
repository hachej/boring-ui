import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Block, Embed, Placeholder, Section, useLocale } from './kit';
import { ChatDemo } from './agents';
import { maquette, taskController } from './mock';
import { TaskListViewer } from '../../registry/task-list-viewer/task-list-viewer';
import { MaquetteViewer } from '../../registry/maquette-viewer/maquette-viewer';
import { LooksViewer } from '../../registry/looks-viewer/looks-viewer';
import looks from '../../test/fixtures/looks/missing-receipts.looks.json';
import looksMockup from '../../test/fixtures/looks/missing-receipts.mockup.html';

const looksText = JSON.stringify(looks);
const readLook = async (path: string) => path.endsWith('missing-receipts.mockup.html') ? looksMockup : undefined;
import { markdownText } from '../../registry/pi-chat-markdown/markdown';
import { ApprovalCard } from '../../registry/pi-chat-approval/approval-card';
import { QuestionCard } from '../../registry/pi-chat-question/question-card';
import { VersionHistoryRows } from '../../registry/version-history/version-history';
import { ViewerActions } from '../../registry/viewer-frame/menu';
import { ToolCard } from '../../registry/pi-chat/tool';
import { SubagentCard } from '../../registry/pi-chat-subagent/subagent-card';
import { RecordsViewer } from '../../registry/record-viewer/record-viewer';
import { MockupViewer } from '../../registry/mockup-viewer/mockup-viewer';
import { Button } from '@/components/ui/button';

/* Fictional fixtures only. Shapes follow the kit's public types (ToolCall = pi-ai's tool call; results are tool result messages). */
const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall' as const, id, name, arguments: args });

const reply = `Here is the **weekly summary** for Atelier Lumen.

- Three orders, one late (A-1043)
- Revenue up 14 % on last week

Run \`export --week 45\` to get the CSV.`;

const versions = [
  { id: 'v3', label: 'Version 3', at: '2026-11-04T09:12:00Z' },
  { id: 'v2', label: 'Version 2', at: '2026-11-03T16:40:00Z' },
  { id: 'v1', label: 'Version 1', at: '2026-11-01T10:05:00Z' },
] as const;

export function Chat() {
  const [picked, setPicked] = useState('v3');
  return <Section id="chat" title="Chat" lead="The pi-chat blocks over a fake controller: the chat in each state a person sees, then its menus open. Fictional data only.">
    <Block name="pi-chat-markdown (reply text)" tokens="--foreground --muted-foreground --border --muted (code)">
      <div className="text-[length:var(--text-body)]">{markdownText({ text: reply, streaming: false }) as ReactNode}</div>
    </Block>
    <Block name="pi-chat-approval (ApprovalCard)" tokens="--border --foreground --destructive; Item, Button">
      <ApprovalCard call={call('a1', 'bash', { command: 'rm -rf build/' })} live={false} />
    </Block>
    <Block name="pi-chat-question (QuestionCard)" tokens="--border --foreground --primary; Item, Button, Input">
      <QuestionCard call={call('q1', 'ask_user', { questions: [{ question: 'Which format?', options: ['PDF', 'CSV'] }] })} live={false} />
    </Block>
    <Block name="pi-chat-version (VersionHistoryRows)" tokens="--foreground --muted-foreground --accent">
      <VersionHistoryRows versions={versions} current="v3" onSelect={setPicked} />
      <span className="text-muted-foreground">Picked: {picked}</span>
    </Block>
    <Block name="pi-chat (tool step, ToolCard)" tokens="--muted --muted-foreground --border --foreground">
      <ToolCard entry={{ key: 't1', call: call('t1', 'read_file', { path: 'orders/A-1041.json' }), result: { role: 'toolResult', toolCallId: 't1', toolName: 'read_file', isError: false, timestamp: 0, content: [{ type: 'text', text: '{"id":"A-1041","total":1204.5}' }] } as never, status: 'done' as never }} />
    </Block>
    <Block name="pi-chat-subagent (SubagentCard)" tokens="--card --border --muted-foreground --foreground">
      <SubagentCard details={{ agent: 'Relances', conversationId: 12, status: 'done' as never, startedAt: 1793800000000, durationMs: 42000, toolCalls: 4, tokens: { input: 3120, output: 640 } }} onOpen={() => undefined} />
    </Block>
    <Block name="pi-chat (empty, with starters)" tokens="--background --muted-foreground --accent" className="gx-chat"><ChatDemo state="empty" /></Block>
    <Block name="pi-chat (connecting)" tokens="--muted-foreground --muted" className="gx-chat"><ChatDemo state="loading" /></Block>
    <Block name="pi-chat (conversation, tool step, Markdown reply)" tokens="--foreground --muted --border" className="gx-chat"><ChatDemo state="populated" /></Block>
    <Block name="pi-chat (reply streaming, Stop)" tokens="--foreground --muted-foreground --primary" className="gx-chat"><ChatDemo state="streaming" /></Block>
    <Block name="pi-chat (reply failed)" tokens="--destructive --destructive-soft" className="gx-chat"><ChatDemo state="error" /></Block>
    <Block name="pi-chat (connection lost)" tokens="--destructive --muted-foreground" className="gx-chat"><ChatDemo state="offline" /></Block>
    <Block name="pi-chat-slash (SlashPicker, open from /)" tokens="--popover --accent --muted-foreground"><Embed name="chat-slash" height={460} title="Slash menu" /></Block>
    <Block name="pi-chat-mentions (MentionPicker, open from @)" tokens="--popover --accent --muted-foreground"><Embed name="chat-mention" height={460} title="Mention menu" /></Block>
    <Block name="pi-chat-pickers (ModelEffortPicker, open)" tokens="--popover --accent"><Embed name="chat-model" height={460} title="Model menu" /></Block>
    <Block name="pi-chat (History, conversation list)" tokens="--popover --accent --muted-foreground"><Embed name="chat-history" height={460} title="Conversation history" /></Block>
    <Placeholder name="pi-chat-attachments (CameraSheet)" tokens="--background --foreground" reason="Opens the device camera (getUserMedia); a headless page has none." />
    <Placeholder name="pi-chat-voice (VoiceMessageButton, VoiceInput)" tokens="--primary --destructive" reason="Records from the microphone through the voice controller; a headless page has none." />
  </Section>;
}

export function Tasks() {
  const populated = useMemo(() => taskController('populated'), []);
  const empty = useMemo(() => taskController('empty'), []);
  const readonly = useMemo(() => taskController('readonly'), []);
  const refused = useMemo(() => taskController('refused'), []);
  useEffect(() => { refused.actions.edit(refused.actions.selection(), [{ kind: 'set-completed', id: 't1', completed: true }]); void refused.flush(refused.actions.selection()); }, [refused]);
  return <Section id="tasks" title="Tasks" lead="The task list over an in-memory resource client: edits, saves and refusals are the controller's own.">
    <Block name="task-list-viewer (saved list)" tokens="--card --muted (row hover) --muted-foreground"><TaskListViewer controller={populated} title="Semaine 45" /></Block>
    <Block name="task-list-viewer (new, empty)" tokens="--card --muted-foreground"><TaskListViewer controller={empty} title="Nouvelle liste" /></Block>
    <Block name="task-list-viewer (read only)" tokens="--card --muted-foreground"><TaskListViewer controller={readonly} title="Semaine 44 (archivée)" /></Block>
    <Block name="task-list-viewer (save refused)" tokens="--destructive"><TaskListViewer controller={refused} title="Semaine 45" /></Block>
    <Block name="board-viewer (BoardViewer, canvas)" tokens="--card --border --muted" className="gx-span" note="tldraw canvas; its icon and font assets are not bundled, so the canvas's own tool icons may be blank."><Embed name="board" height={520} title="Board" /></Block>
  </Section>;
}

export function Pm() {
  const locale = useLocale();
  return <Section id="pm" title="PM and annotation" lead="Viewers for the PM agent's artifacts and the annotation tools, over fictional files.">
    <Block name="viewer-frame (ViewerActions)" tokens="--popover --border --foreground">
      <ViewerActions label="Actions" items={[{ label: 'Copy link', onSelect: () => undefined }, { label: 'Download', onSelect: () => undefined }]}>
        <Button variant="outline" size="sm">Actions</Button>
      </ViewerActions>
    </Block>
    <Block name="record-viewer (RecordsViewer)" tokens="--border --muted-foreground --foreground" className="gx-span">
      <RecordsViewer locale="en" text={JSON.stringify({ kind: 'records@1', columns: [{ key: 'client', label: 'Client', type: 'text' }, { key: 'total', label: 'Total', type: 'number' }, { key: 'status', label: 'Status', type: 'status' }], rows: [{ id: 'A-1041', values: { client: 'Atelier Lumen', total: 1204.5, status: { label: 'Paid', tone: 'ok' } } }, { id: 'A-1042', values: { client: 'Maison Orme', total: 388, status: { label: 'Pending', tone: 'warn' } } }, { id: 'A-1043', values: { client: 'Studio Vallon', total: 2910, status: { label: 'Late', tone: 'error' } } }] })} onAction={() => undefined} />
    </Block>
    <Block name="mockup-viewer (MockupViewer)" tokens="--background --foreground --card --border" className="gx-span">
      <MockupViewer locale="en" path="fictional/checkout.mockup.html" text={'<!doctype html><html><body style="font-family:sans-serif;margin:0;padding:16px;background:#fff;color:#111"><h1 style="font-size:14px;margin:0 0 8px">Order A-1041</h1><div style="border:1px solid #e5e5e5;border-radius:8px;padding:12px;font-size:12px">Atelier Lumen · 1 204,50</div><button style="margin-top:12px;font-size:12px;padding:6px 10px;border-radius:6px;background:#18181b;color:#fff;border:0">Confirm</button></body></html>'} />
    </Block>
    <Block name="maquette-viewer (MaquetteViewer)" tokens="--card --muted --foreground --primary" className="gx-span"><MaquetteViewer text={maquette} path="maquettes/reservation.maquette.json" locale={locale} /></Block>
    <Block name="looks-viewer (LooksViewer)" tokens="--card --muted --accent" className="gx-span"><LooksViewer text={looksText} path="looks/missing-receipts.looks.json" read={readLook} locale={locale} onPick={() => undefined} /></Block>
    <Block name="agent-target (AgentTargetMode, pointing on)" tokens="--ring --primary --card" className="gx-span" note="Hover a row to see the pointer target; a pick then starts dictation (microphone)."><Embed name="agent-target" height={360} title="Agent target" /></Block>
    <Placeholder name="viewer-frame (InteractiveFrame)" tokens="--background" reason="Runs untrusted HTML in a sandboxed iframe; not shown in a gallery page by design." />
  </Section>;
}

export function Layouts() {
  return <Section id="layouts" title="Agent layouts" lead="How the agent sits in an app. Each frame is a real AppShell or workspace in its own viewport, over the fake chat.">
    <Block name="AppShell, full page (screen layout)" tokens="--sidebar (= canvas) --background --card" className="gx-span"><Embed name="shell" height={460} title="AppShell, full page" /></Block>
    <Block name="app-shell dock (agent open beside the page)" tokens="--sidebar --background --card" className="gx-span"><Embed name="dock" height={560} title="Agent dock" /></Block>
    <div className="gx-span gx-phones">
      <Block name="AppShell, phone (390px, tab bar)" tokens="--background --card"><Embed name="shell" height={640} width={390} title="AppShell, phone" /></Block>
      <Block name="app-shell bottom drawer, peek" tokens="--card --muted-foreground"><Embed name="drawer-peek" height={640} width={390} title="Drawer, peek" /></Block>
      <Block name="app-shell bottom drawer, half" tokens="--card --background (scrim)"><Embed name="drawer-half" height={640} width={390} title="Drawer, half" /></Block>
      <Block name="app-shell bottom drawer, full" tokens="--card --background"><Embed name="drawer-full" height={640} width={390} title="Drawer, full" /></Block>
    </div>
    <Block name="pi-app (AgentWorkspace: sessions, chat, task panel)" tokens="--background --card --sidebar" className="gx-span"><Embed name="pi-app" height={560} title="Agent workspace" /></Block>
    <Block name="PM layout (AgentWorkspace with a maquette open)" tokens="--background --card" className="gx-span"><Embed name="pm" height={600} title="PM layout" /></Block>
    <Block name="detached (Dock floating, AmbientChat over the app)" tokens="--card --popover --muted-foreground" className="gx-span"><Embed name="detached" height={520} title="Detached chat" /></Block>
    <Block name="windows (floating windows)" tokens="--card --muted-foreground"><Embed name="windows" height={260} title="Floating windows" /></Block>
  </Section>;
}
