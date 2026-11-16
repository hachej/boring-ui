import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../../registry/app-shell/app-shell.tsx';
import { ScreenBody } from '../../registry/app-shell/screen-body.tsx';
import { FileTextIcon, FolderIcon } from '../../registry/_shared/icons';
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

// Component scenario `component:design-system`, the site's home, full screen: the page IS the app. The kit's AppShell at its defaults (navigation, header, the
// assistant's bar, the right pane, the phone's tab bar) with the design system as its app view, and an empty app view as its second screen. Kit parts and tokens only.
// The site injects `window.__pages` (its other pages, as links in the sidebar). Query: `dark=1`; the theme otherwise follows the site's switch.
const stored = (() => { try { return localStorage.getItem('ux-theme'); } catch { return null; } })();
const initial = new URLSearchParams(location.search).get('dark') === '1' || stored === 'dark' || (!stored && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
const applyTheme = value => { document.documentElement.classList.toggle('dark', value === 'dark'); try { localStorage.setItem('ux-theme', value); } catch { /* private mode */ } };
applyTheme(initial);
const COLOURS = [['background', 'bg-background'], ['foreground', 'bg-foreground'], ['card', 'bg-card'], ['muted', 'bg-muted'], ['muted-foreground', 'bg-muted-foreground'], ['primary', 'bg-primary'], ['primary-foreground', 'bg-primary-foreground'], ['secondary', 'bg-secondary'], ['accent', 'bg-accent'], ['border', 'bg-border'], ['input', 'bg-input'], ['ring', 'bg-ring'], ['destructive', 'bg-destructive'], ['success', 'bg-success'], ['warning', 'bg-warning'], ['info', 'bg-info']];
const SCALE = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl'];
const Section = ({ id, title, children }) => <section data-testid={`ds-${id}`} className="flex flex-col gap-3"><h2 className="m-0 text-lg font-semibold">{title}</h2>{children}</section>;
const Row = ({ children }) => <div className="flex flex-wrap items-center gap-2">{children}</div>;

function Page() {
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
      <Alert><AlertTitle>A notice</AlertTitle><AlertDescription>One status row, in the kit's words.</AlertDescription></Alert></Section>
    <Section id="lists" title="Rows, table, card">
      <ItemGroup className="gap-1">{['First row', 'Second row'].map(name => <Item key={name} variant="outline" size="sm"><ItemContent><ItemTitle>{name}</ItemTitle><ItemDescription>A description</ItemDescription></ItemContent></Item>)}</ItemGroup>
      <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Jan 02</TableCell><TableCell className="text-right tabular-nums">$12.00</TableCell></TableRow></TableBody></Table>
      <Card><CardHeader><CardTitle>A card</CardTitle><CardDescription>Flat, one border.</CardDescription></CardHeader><CardContent>Content</CardContent></Card>
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
let snapshot = { identity: { runtimeId: 'fictional', scopeId: 'design-system', principalId: 'fictional-reader' }, conversationId: 'design-system', connection: { kind: 'connected' },
  view: { entries: [], docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], echo: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
const listeners = new Set();
const change = patch => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
const controller = {
  getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  setText: text => change({ draft: { ...snapshot.draft, text, version: snapshot.draft.version + 1 } }),
  setAttachments: attachments => change({ draft: { ...snapshot.draft, attachments, version: snapshot.draft.version + 1 } }),
  send: async () => undefined, connect: async () => {}, stop: async () => {}, dispose: async () => {}, clearHistory() {}, loadEarlier: async () => {}, reconcile: async () => {}, retrySameRequest: async () => {},
};
const pages = window.__pages ?? [];
const links = () => <nav aria-label="Pages" className="flex flex-col gap-1 p-2">{pages.map(page => <Button key={page.href} variant="ghost" href={page.href} className="justify-start">{page.title}</Button>)}</nav>;
const nav = [
  { id: 'design', label: 'Design system', icon: FileTextIcon, render: () => <ScreenBody><Page /></ScreenBody>, ...(pages.length ? { sidebar: links, sidebarLabel: 'Pages' } : {}) },
  { id: 'empty', label: 'Empty app view', icon: FolderIcon, render: () => <ScreenBody><Placeholder /></ScreenBody> },
];
const agent = { controller, label: 'Assistant', library: () => <Placeholder />, chatProps: { title: 'Assistant', locale: 'en' } };
function App() {
  const [route, setRoute] = useState('design'), [theme, setTheme] = useState(initial);
  return <AppShell layout="screen" locale="en" title="Boring UI" nav={nav} route={{ id: route, onChange: setRoute }} composer="bar" agent={agent}
    account={{ name: 'Visitor', menu: [], theme: { value: theme, onChange: value => { applyTheme(value); setTheme(value); } } }} />;
}
createRoot(document.getElementById('root')).render(<App />);
