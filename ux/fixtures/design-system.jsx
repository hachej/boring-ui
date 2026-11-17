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
import { SlashPicker } from '../../registry/pi-chat-slash/slash-menu.tsx';
import { UpdateNotice } from '../../registry/app-shell/update-notice.tsx';
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
      <UpdateNotice update={{ available: true, version: 'v2', onReload() {} }} text={appShellText('en')} compact={false} /></Section>
    <Section id="lists" title="Rows, table, card">
      <ItemGroup className="gap-1">{['First row', 'Second row'].map(name => <Item key={name} variant="outline" size="sm"><ItemContent><ItemTitle>{name}</ItemTitle><ItemDescription>A description</ItemDescription></ItemContent></Item>)}</ItemGroup>
      <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Jan 02</TableCell><TableCell className="text-right tabular-nums">$12.00</TableCell></TableRow></TableBody></Table>
      <Card><CardHeader><CardTitle>A card</CardTitle><CardDescription>Flat, one border.</CardDescription></CardHeader><CardContent>Content</CardContent></Card>
    </Section>
    <Section id="files" title="File tree: every viewer"><div className="rounded-lg border"><FileTreeView controller={demoTree()} variant="plain" locale="en" upload={false} history={false} refresh={false} onOpen={path => layer.pane.push({ file: path })} /></div></Section>
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
window.__ux = { reset };
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
// The `/` menu. The app's provider is one list (`id`, `kind`, `label`, `description`, `argumentHint`); the kit takes it as `slash.commands`, `slash.skills` and `slash.actions`.
// A command acts on the page, a skill is text for the assistant (`/summarize <file>`), an action asks the assistant to do something for the person.
const ask = text => controller.send('followUp', { text, attachments: [], restore: { text: '', attachments: [] } });
const PROVIDER = [
  { id: 'clear', kind: 'command', label: 'clear', description: 'Start a fresh conversation', run: () => reset() },
  { id: 'help', kind: 'command', label: 'help', description: 'Ask what the assistant can do', run: api => api.setText('What can you do here?') },
  { id: 'shortcuts', kind: 'command', label: 'shortcuts', description: 'List the keyboard shortcuts', run: api => api.setText('Which keyboard shortcuts are there?') },
  { id: 'summarize', kind: 'skill', label: 'summarize', description: 'Summarize a table in a few lines', argumentHint: '<file>' },
  { id: 'draft-reminder', kind: 'skill', label: 'draft-reminder', description: 'Write a polite payment reminder', argumentHint: '<customer>' },
  { id: 'review-entries', kind: 'skill', label: 'review-entries', description: 'Look for errors in the entries' },
  { id: 'export-gaps', kind: 'action', label: 'export-gaps', description: 'Save the open gaps as a CSV file', run: () => ask('Export the open gaps') },
  { id: 'archive-draft', kind: 'action', label: 'archive-draft', description: 'Move the old draft to the archive', run: () => ask('Archive the old draft') },
  { id: 'new-entry', kind: 'action', label: 'new-entry', description: 'Add an entry to the journal', argumentHint: '<amount>', run: api => api.setText(`New entry ${api.text}`.trim()) },
];
const toSlash = list => ({ Picker: SlashPicker, ...Object.fromEntries([['commands', 'command'], ['skills', 'skill'], ['actions', 'action']].map(([key, kind]) => [key,
  list.filter(item => item.kind === kind).map(({ label, description, argumentHint, run }) => ({ name: label, description, ...(argumentHint ? { argumentHint } : {}), ...(run ? { run } : {}) }))])) });
const slash = toSlash(PROVIDER);
const attachments = { upload: async files => files.map(file => ({ name: file.name, path: `uploads/${file.name}` })) };
const nav = [
  { id: 'design', label: 'Design system', icon: FileTextIcon, render: () => <ScreenBody><Page /></ScreenBody> },
  { id: 'empty', label: 'Empty app view', icon: FolderIcon, render: () => <ScreenBody><Placeholder /></ScreenBody> },
];
const agent = { controller, label: 'Assistant', replyAction: { label: 'Undo the change', icon: <Undo2Icon />, onSelect() { window.__undone = (window.__undone ?? 0) + 1; } }, voice: { transcribe: async () => 'Dictated text (fictional)' }, files: demoFiles, fileKinds: DEMO_KINDS, library: () => <Placeholder />, chatProps: { title: 'Assistant', locale: 'en', actions, attachments, mentions, slash, labels: { placeholder: 'Ask, or type /' } } };
function App() {
  const [route, setRoute] = useState('design'), [theme, setTheme] = useState(initial);
  return <AppShell layout="screen" locale="en" title="Boring UI" nav={nav} route={{ id: route, onChange: setRoute }} composer="bar" agent={agent}
    account={{ name: 'Visitor', menu: [], theme: { value: theme, onChange: value => { applyTheme(value); setTheme(value); } } }} />;
}
createRoot(document.getElementById('root')).render(<App />);
