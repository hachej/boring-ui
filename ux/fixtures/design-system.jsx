import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../registry/app-shell/app-shell.tsx';
import { ScreenBody } from '../../registry/app-shell/screen-body.tsx';
import { FileTextIcon, FolderIcon, Undo2Icon } from '../../registry/_shared/icons';
import { FileTreeView } from '../../registry/file-tree/file-tree.tsx';
import { useAgentLayer } from '../../registry/app-shell/agent-layer.tsx';
import { DEMO_KINDS, demoTree } from '../../test/fixtures/themes/one-composer-demo.jsx';
import { DEMO_FILES, demoFiles } from '../../test/fixtures/themes/one-composer-files.js';
import { csvRows } from '../../registry/viewer-code/csv-table.tsx';
import { columnNames, rowMentionPath, rowReferenceLabel } from '../../registry/viewer-code/row-reference.tsx';
import { createDemoController } from './demo-controller.mjs';
import { installFakeMic } from './fake-mic.mjs';
import script from '../scenarios/scripts/design-system.json';
import { demoSlash } from './demo-slash.jsx';
import { TASKS, Task } from './agent-card-demo.jsx';
import { NoticeHost } from '../../registry/app-shell/shell-notice.tsx';
import { updateNotice } from '../../registry/app-shell/update-notice.tsx';
import { appShellText } from '../../registry/app-shell/text.ts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

// Component scenario `component:design-system`, the site's home, in the site's frame. The kit's AppShell at its defaults (navigation, header, the
// assistant's bar, the right pane, the phone's tab bar) with the design system as its app view, and an empty app view as its second screen. Kit parts and tokens only.
// Query: `dark=1`; the theme otherwise follows the site's switch.
const stored = (() => { try { return localStorage.getItem('ux-theme'); } catch { return null; } })();
const initial = new URLSearchParams(location.search).get('dark') === '1' || stored === 'dark' || (!stored && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
const applyTheme = value => { document.documentElement.classList.toggle('dark', value === 'dark'); try { localStorage.setItem('ux-theme', value); } catch { /* private mode */ } };
applyTheme(initial);
const COLOURS = [['background', 'bg-background'], ['foreground', 'bg-foreground'], ['card', 'bg-card'], ['muted', 'bg-muted'], ['muted-foreground', 'bg-muted-foreground'], ['primary', 'bg-primary'], ['primary-foreground', 'bg-primary-foreground'], ['secondary', 'bg-secondary'], ['accent', 'bg-accent'], ['border', 'bg-border'], ['input', 'bg-input'], ['ring', 'bg-ring'], ['destructive', 'bg-destructive'], ['success', 'bg-success'], ['warning', 'bg-warning'], ['info', 'bg-info']];
const SCALE = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl'];
const Section = ({ id, title, children }) => <section data-testid={`ds-${id}`} className="flex flex-col gap-3"><h2 className="m-0 text-lg font-semibold">{title}</h2>{children}</section>;
const Row = ({ children }) => <div className="flex flex-wrap items-center gap-2">{children}</div>;

// The « Agent cards » section: the kit's AgentCard for three agents in their colours (Reader, Mailer, Ledger) and a task card, folded by default;
// the strip on a card's lower border opens its chat. Each card has its own scripted agent (`agent-card-demo.jsx`, shared with the Agent cards page).
const SHOWN = ['running', 'needs', 'done', 'task'];
function AgentCards() {
  const [levels, setLevels] = useState({});
  return <div data-testid="ds-agent-card-list" className="flex flex-col">
    {TASKS.filter(task => SHOWN.includes(task.id)).map(task => <Task key={task.id} task={task} level={levels[task.id] ?? 0} onLevel={level => setLevels(now => ({ ...now, [task.id]: level }))} dock={null} docked={false} onDocked={() => {}} />)}
  </div>;
}

function Page() {
  const layer = useAgentLayer();
  return <div className="mx-auto flex max-w-3xl flex-col gap-8 text-sm">
    <p className="m-0 text-muted-foreground">The kit's defaults, light and dark: switch the theme in the account menu. Fictional content.</p>
    <Section id="colours" title="Colours"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{COLOURS.map(([name, bg]) => <div key={name} className="flex flex-col gap-1"><div className={`h-10 rounded-md border ${bg}`} /><span className="text-xs">{name}</span></div>)}</div></Section>
    <Section id="type" title="Type, radius, shadow">
      {SCALE.map(size => <p key={size} className={`m-0 ${size}`}>{size} The quick brown fox</p>)}
      <Row>{['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl'].map(r => <div key={r} className={`flex h-12 w-20 items-center justify-center border bg-card text-xs ${r}`}>{r.slice(8)}</div>)}
        {['shadow-xs', 'shadow-sm', 'shadow-md'].map(s => <div key={s} className={`flex h-12 w-20 items-center justify-center rounded-md bg-card text-xs ${s}`}>{s.slice(7)}</div>)}</Row>
    </Section>
    <Section id="buttons" title="Buttons"><Row>{['default', 'secondary', 'outline', 'ghost', 'destructive'].map(variant => <Button key={variant} variant={variant}>{variant}</Button>)}</Row><Row><Button size="sm">Small</Button><Button disabled>Disabled</Button></Row></Section>
    <Section id="forms" title="Form controls">
      <Input placeholder="Text field" /><Textarea placeholder="Message" rows={2} />
      <Label><Checkbox defaultChecked />Checkbox</Label><Label><Switch defaultChecked />Switch</Label><Progress value={60} />
    </Section>
    <Section id="status" title="Status and notices"><Row><Badge>Default</Badge><Badge variant="success">Reconciled</Badge><Badge variant="warning">Gap</Badge><Badge variant="info">Info</Badge><Badge variant="destructive">Failed</Badge></Row>
      <Alert><AlertTitle>A notice</AlertTitle><AlertDescription>One status row, in the kit's words.</AlertDescription></Alert>
      <NoticeHost notices={[updateNotice({ available: true, version: 'v2', onReload() {} }, appShellText('en'))]} text={appShellText('en')} compact={false} /></Section>
    <Section id="lists" title="Rows, table, card">
      <ItemGroup className="gap-1">{['First row', 'Second row'].map(name => <Item key={name} variant="outline" size="sm"><ItemContent><ItemTitle>{name}</ItemTitle><ItemDescription>A description</ItemDescription></ItemContent></Item>)}</ItemGroup>
      <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Jan 02</TableCell><TableCell className="text-right tabular-nums">$12.00</TableCell></TableRow></TableBody></Table>
      <Card><CardHeader><CardTitle>A card</CardTitle><CardDescription>Flat, one border.</CardDescription></CardHeader><CardContent>Content</CardContent></Card>
    </Section>
    <Section id="files" title="File tree: every viewer"><div className="rounded-lg border"><FileTreeView controller={demoTree()} variant="plain" locale="en" upload={false} history={false} refresh={false} onOpen={path => layer.pane.push({ file: path })} /></div><p data-testid="ds-files-note" className="m-0 text-sm text-muted-foreground">Boards and canvases (tldraw) are not in this public demo: tldraw needs a licence key for production use (docs/architecture/CANVAS.md). They are checked by their own journeys (npm run board:journey).</p></Section>
    <Section id="agent-cards" title="Agent cards">
      <p className="m-0 text-muted-foreground">One unit of agent work as a folding card, three agents in their colours and a task card. Folded, a card is a header and what the agent does; a decision it waits for shows right on it. The strip on its lower border opens the chat, as on the assistant bar.</p>
      <AgentCards />
    </Section>
    <Section id="notifications" title="Notifications">
      <p className="m-0 text-muted-foreground">One notice at a time, shown above the assistant bar (look at the bottom of the screen). A decision the agent waits for rings the bar; a reply that arrives while the conversation is folded puts a count on the notch.</p>
      <Row>{['info', 'success', 'warning', 'error'].map(kind => <Button key={kind} variant="outline" data-testid={`ds-notify-${kind}`} onClick={() => notify(kind)}>{kind[0].toUpperCase() + kind.slice(1)}</Button>)}
        <Button variant="outline" data-testid="ds-notify-needs" onClick={() => { layer.close(); void controller.send('followUp', { text: 'approval', attachments: [], restore: { text: '', attachments: [] } }); }}>Needs you</Button>
        <Button variant="outline" data-testid="ds-notify-reply" onClick={() => { layer.close(); void controller.send('followUp', { text: 'answer', attachments: [], restore: { text: '', attachments: [] } }); }}>A reply arrives while folded</Button></Row>
    </Section>
    <Section id="navigation" title="Tabs, dialog, empty, loading">
      <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">All</TabsTrigger><TabsTrigger value="b">Gaps</TabsTrigger></TabsList><TabsContent value="a">Everything</TabsContent><TabsContent value="b">Only gaps</TabsContent></Tabs>
      <Dialog><DialogTrigger render={<Button variant="outline" className="self-start">Open a dialog</Button>} /><DialogContent><DialogHeader><DialogTitle>A dialog</DialogTitle><DialogDescription>Kit defaults.</DialogDescription></DialogHeader></DialogContent></Dialog>
      <Empty><EmptyHeader><EmptyTitle>Nothing here yet</EmptyTitle><EmptyDescription>The app view starts like this.</EmptyDescription></EmptyHeader></Empty>
      <Skeleton className="h-8 w-full" />
    </Section>
  </div>;
}
const Placeholder = () => <Empty><EmptyHeader><EmptyTitle>Nothing here yet</EmptyTitle><EmptyDescription>The app's screen goes here.</EmptyDescription></EmptyHeader></Empty>;
const { controller, actions, reset } = createDemoController({ script, pace: new URLSearchParams(location.search).get('pace') === 'instant' ? 0.15 : 1 });
// What the assistant received, for a test: the text of each send, mention tokens included.
const deliver = controller.send;
controller.send = async (kind, content) => { (window.__sent ??= []).push({ kind, text: content?.text ?? controller.getSnapshot().draft.text }); return deliver(kind, content); };
// The Play menu's Notifications group: `window.__ux.notify(kind)` shows one of the shell's notices (the person's own dismiss or the fade removes it).
const NOTICES = {
  info: { kind: 'info', text: 'Harbor Garage synced 12 new entries.', action: { label: 'View', onSelect() {} } },
  success: { kind: 'success', text: 'The January statement is saved.', action: { label: 'Undo', onSelect() {} } },
  warning: { kind: 'warning', text: 'Two rows of open-gaps.csv have no amount.', action: { label: 'Review', onSelect() {} }, reference: '@samples/open-gaps.csv' },
  error: { kind: 'error', text: 'The export of open-gaps.csv failed.', action: { label: 'Retry', onSelect() {} }, reference: '@samples/open-gaps.csv' },
};
let notify = () => {};
window.__ux = { reset, notify: kind => notify(kind) };
installFakeMic();
// The `@` picker lists the workspace's files and the rows of the sample table (`@open-gaps`): a row is the same `row` mention the table's « @ » action inserts.
const TABLE = 'samples/open-gaps.csv';
const tableRows = async () => {
  const [head = [], ...rows] = csvRows(await (await demoFiles.read(TABLE)).blob.text()), names = columnNames(head);
  return rows.map((row, at) => rowMentionPath({ path: TABLE, rows: [{ row: at + 1, cells: Object.fromEntries(names.map((name, j) => [name, row[j] ?? ''])) }] }));
};
const mentions = { listLabel: 'Files and rows', search: async query => {
  const needle = query.toLowerCase();
  const files = DEMO_FILES.filter(path => path.toLowerCase().includes(needle)).slice(0, 4).map(path => ({ path, kind: 'file' }));
  const rows = (await tableRows()).map(path => ({ path, label: rowReferenceLabel(path.slice(4)) })).filter(row => row.label.toLowerCase().includes(needle) || TABLE.includes(needle));
  return [...files, ...rows];
} };
const slash = demoSlash({ controller, reset });
const attachments = { upload: async files => files.map(file => ({ name: file.name, path: `uploads/${file.name}` })) };
const nav = [
  { id: 'design', label: 'Design system', icon: FileTextIcon, render: () => <ScreenBody><Page /></ScreenBody> },
  { id: 'empty', label: 'Empty app view', icon: FolderIcon, render: () => <ScreenBody><Placeholder /></ScreenBody> },
];
const agent = { controller, label: 'Assistant', replyAction: { label: 'Undo the change', icon: <Undo2Icon />, onSelect() { window.__undone = (window.__undone ?? 0) + 1; } }, voice: { transcribe: async () => 'Dictated text (fictional)' }, files: demoFiles, fileKinds: DEMO_KINDS, library: () => <Placeholder />, chatProps: { title: 'Assistant', locale: 'en', actions, attachments, mentions, slash, labels: { placeholder: 'Ask, or type /' } } };
function App() {
  const [route, setRoute] = useState('design'), [theme, setTheme] = useState(initial), [notices, setNotices] = useState([]);
  notify = kind => { const id = `${kind}-${Date.now()}`; setNotices([{ ...NOTICES[kind], id, onDismiss: () => setNotices(list => list.filter(n => n.id !== id)) }]); };
  return <AppShell layout="screen" locale="en" title="Boring UI" nav={nav} route={{ id: route, onChange: setRoute }} composer="bar" agent={agent} notices={notices}
    account={{ name: 'Visitor', menu: [], theme: { value: theme, onChange: value => { applyTheme(value); setTheme(value); } } }} />;
}
createRoot(document.getElementById('root')).render(<App />);
