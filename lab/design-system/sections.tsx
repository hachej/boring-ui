import { useState } from 'react';
import type { ReactNode } from 'react';
import { Block, Embed, Placeholder, Section } from './kit';
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
  return <Section id="chat" title="Chat" lead="The pi-chat blocks with fictional fixtures. Each block that needs a live controller or a host store shows a placeholder with the reason.">
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
    <Placeholder name="pi-chat-attachments (CameraSheet)" tokens="--background --foreground" reason="Opens the device camera (getUserMedia); cannot run in a headless page." />
    <Placeholder name="pi-chat-voice (VoiceMessageButton, VoiceInput)" tokens="--primary --destructive" reason="Records from the microphone through the voice controller; cannot run in a headless page." />
    <Placeholder name="pi-chat-mentions, pi-chat-slash, pi-chat-pickers" tokens="--popover --accent --muted-foreground" reason="Pickers are positioned menus opened from the composer (@ and / keys, model menu); they need the composer's open state and a host search." />
    <Placeholder name="pi-chat (Composer, history)" tokens="--border --input --ring" reason="The composer and conversation history are wired to a chat session and a conversation store." />
  </Section>;
}

export function Tasks() {
  return <Section id="tasks" title="Tasks" lead="Task list, board and version history.">
    <Placeholder name="task-list-viewer (TaskListViewer)" tokens="--border --foreground --muted-foreground" reason="Reads a TaskListController over a task document; the kit has no standalone task fixture." />
    <Placeholder name="board-viewer (BoardViewer)" tokens="--card --border --muted" reason="Reads a board document through a host; the kit exposes no standalone board fixture." />
  </Section>;
}

export function Pm() {
  return <Section id="pm" title="PM and annotation" lead="Viewers for the PM agent's artifacts and the annotation tools. Viewer frame actions are real; viewers that parse a host file are placeholders.">
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
    <Placeholder name="maquette-viewer (MaquetteViewer)" tokens="--card --border --foreground" reason="Parses a .maquette.json document from a PM agent; a valid fixture needs that schema and is not in the kit." />
    <Placeholder name="mockup-viewer (MockupViewer)" tokens="--background --foreground" reason="Compiles a mock-up in a sandboxed frame with Tailwind at run time; the build needs a mock-up source file." />
    <Placeholder name="looks-viewer (LooksViewer)" tokens="--card --border" reason="Reads a looks file and its variants from a host; no fixture in the kit." />
    <Placeholder name="agent-target (AgentTargetMode)" tokens="--ring --primary" reason="Points and dictates on marked app data; it needs a transcription service and a marked app page." />
    <Placeholder name="record-viewer (RecordsViewer)" tokens="--border --muted-foreground" reason="Parses a records file; no fixture in the kit." />
    <Placeholder name="viewer-frame (InteractiveFrame)" tokens="--background" reason="Runs untrusted HTML in a sandboxed iframe; not shown in a gallery page by design." />
  </Section>;
}

export function Layouts() {
  return <Section id="layouts" title="Agent layouts" lead="How the agent sits in an app. Each frame is a real AppShell in its own viewport.">
    <Block name="AppShell, full page (screen layout)" tokens="--sidebar (= canvas) --background --card" className="gx-span">
      <Embed name="shell" height={460} title="AppShell, full page" />
    </Block>
    <Block name="AppShell, phone (390px, tab bar)" tokens="--background --card --border">
      <Embed name="shell" height={560} width={390} title="AppShell, phone" />
    </Block>
    <Placeholder name="app-shell dock (AgentDockLayout)" tokens="--sidebar --border" reason="The docked right agent needs an agent with a real chat controller (chatProps); the gallery has none." />
    <Placeholder name="app-shell bottom drawer (peek, half, full)" tokens="--card --border --muted-foreground" reason="Snap states are driven by the agent layer over a real chat; the drawer does not open without one." />
    <Block name="windows (detached, floating)" tokens="--card --border --muted-foreground">
      <Embed name="windows" height={260} title="Floating windows" />
    </Block>
    <Placeholder name="pi-app (AgentWorkspace, sessions and viewers)" tokens="--background --card" reason="The whole agent app needs sessions and a resource client; it is not a standalone component." />
  </Section>;
}
