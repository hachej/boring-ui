import { useState } from 'react';
import { Block, Section } from './kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '../../registry/data-table/data-table';
import { KpiRow, KpiStat } from '../../registry/kpi-stat/kpi-stat';
import { ListRow } from '../../registry/list-row/list-row';
import { EmptyState } from '../../registry/empty-state/blank-state';
import { PageHeader } from '../../registry/page-header/page-header';
import { Sparkles } from '../../registry/_shared/icons';
import { Embed } from './kit';

type Order = { id: string; client: string; status: string; total: string; date: string; owner: string };
const orders: Order[] = [
  { id: 'A-1041', client: 'Atelier Lumen', status: 'Paid', total: '1 204,50', date: '12 Mar', owner: 'Camille' },
  { id: 'A-1042', client: 'Maison Orme', status: 'Pending', total: '388,00', date: '13 Mar', owner: 'Noah' },
  { id: 'A-1043', client: 'Studio Vallon', status: 'Late', total: '2 910,00', date: '14 Mar', owner: 'Inès' },
];
const columns = [
  { id: 'client', header: 'Client', priority: 1 as const, cell: (r: Order) => r.client },
  { id: 'id', header: 'Order', priority: 2 as const, cell: (r: Order) => <span className="tabular-nums text-muted-foreground">{r.id}</span> },
  { id: 'status', header: 'Status', priority: 2 as const, cell: (r: Order) => <Badge variant="secondary">{r.status}</Badge> },
  { id: 'total', header: 'Total', priority: 2 as const, numeric: true, cell: (r: Order) => r.total },
  { id: 'date', header: 'Date', priority: 3 as const, cell: (r: Order) => r.date },
  { id: 'owner', header: 'Owner', priority: 3 as const, cell: (r: Order) => r.owner },
];

export function Level1() {
  const [tab, setTab] = useState('overview');
  return <Section id="level1" title="Level 1: generic" lead="The kit's primitives and the neutral blocks. Flat cards, never nested. Rows stack below 520px of container width.">
    <Block name="Button" tokens="--primary --secondary --accent --destructive --ring"><div className="gx-row">
      <Button>Default</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button><Button size="sm">Small</Button><Button disabled>Disabled</Button>
    </div></Block>
    <Block name="Input, Textarea, Select" tokens="--input --border --ring --muted-foreground"><div className="gx-stack">
      <div className="gx-field"><Label htmlFor="gx-name">Name</Label><Input id="gx-name" placeholder="Atelier Lumen" /></div>
      <div className="gx-field"><Label htmlFor="gx-note">Note</Label><Textarea id="gx-note" placeholder="A short note" /></div>
      <div className="gx-field"><Label>Status</Label>
        <Select defaultValue="open"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="paid">Paid</SelectItem><SelectItem value="late">Late</SelectItem></SelectContent></Select></div>
    </div></Block>
    <Block name="Checkbox, Switch" tokens="--primary --input --ring"><div className="gx-stack">
      <div className="gx-row"><Checkbox id="gx-c1" defaultChecked /><Label htmlFor="gx-c1">Send a receipt</Label></div>
      <div className="gx-row"><Checkbox id="gx-c2" /><Label htmlFor="gx-c2">Remind me</Label></div>
      <div className="gx-row"><Switch id="gx-s1" defaultChecked /><Label htmlFor="gx-s1">Notifications</Label></div>
    </div></Block>
    <Block name="Badge" tokens="--primary --secondary --destructive --border"><div className="gx-row">
      <Badge>Default</Badge><Badge variant="secondary">Secondary</Badge><Badge variant="outline">Outline</Badge><Badge variant="destructive">Late</Badge>
    </div></Block>
    <Block name="Tabs" tokens="--muted --foreground --background">
      <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="orders">Orders</TabsTrigger><TabsTrigger value="notes">Notes</TabsTrigger></TabsList>
        <TabsContent value="overview" className="pt-3">Three open orders this week.</TabsContent><TabsContent value="orders" className="pt-3">A-1041, A-1042, A-1043.</TabsContent><TabsContent value="notes" className="pt-3">No notes yet.</TabsContent></Tabs>
    </Block>
    <Block name="Alert" tokens="--card --foreground --destructive --border"><div className="gx-stack">
      <Alert><AlertTitle>Saved</AlertTitle><AlertDescription>Your changes are in.</AlertDescription></Alert>
      <Alert variant="destructive"><AlertTitle>Payment failed</AlertTitle><AlertDescription>The card was declined.</AlertDescription></Alert>
    </div></Block>
    <Block name="Dialog and Sheet" tokens="--card --border --foreground (overlay: click to open)"><div className="gx-row">
      <Dialog><DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger><DialogContent><DialogHeader><DialogTitle>Archive this order?</DialogTitle><DialogDescription>It stays searchable.</DialogDescription></DialogHeader><DialogFooter><Button>Archive</Button></DialogFooter></DialogContent></Dialog>
      <Sheet><SheetTrigger render={<Button variant="outline" />}>Open sheet</SheetTrigger><SheetContent><SheetHeader><SheetTitle>Order A-1041</SheetTitle><SheetDescription>Atelier Lumen, 1 204,50</SheetDescription></SheetHeader></SheetContent></Sheet>
    </div></Block>
    <Block name="Popover, Tooltip, DropdownMenu" tokens="--popover --border --foreground (open states)"><div className="gx-row gx-tall">
      <Popover><PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger><PopoverContent><PopoverHeader><PopoverTitle>Due date</PopoverTitle><PopoverDescription>Pick a day.</PopoverDescription></PopoverHeader></PopoverContent></Popover>
      <TooltipProvider><Tooltip><TooltipTrigger render={<Button variant="outline" />}>Tooltip</TooltipTrigger><TooltipContent>Copies the link</TooltipContent></Tooltip></TooltipProvider>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}>Menu</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel>Order</DropdownMenuLabel><DropdownMenuItem>Duplicate</DropdownMenuItem><DropdownMenuItem>Archive</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem>Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div></Block>
    <Block name="Card (flat)" tokens="--card --foreground --border (no ring, no shadow, never nested)">
      <Card className="ring-0 shadow-none"><CardHeader><CardTitle>Weekly summary</CardTitle><CardDescription>Fictional figures</CardDescription></CardHeader><CardContent>Three orders, one late.</CardContent></Card>
    </Block>
    <Block name="Table" tokens="--border --muted-foreground">
      <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Order</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
        <TableBody>{orders.map(o => <TableRow key={o.id}><TableCell>{o.client}</TableCell><TableCell className="tabular-nums text-muted-foreground">{o.id}</TableCell><TableCell className="text-right tabular-nums">{o.total}</TableCell></TableRow>)}</TableBody></Table>
    </Block>
    <Block name="DataTable (wide)" tokens="--border --muted-foreground; container query" className="gx-span"><DataTable caption="Orders" columns={columns} rows={orders} rowKey={r => r.id} /></Block>
    <Block name="DataTable (stacked, 360px container)" tokens="same block, narrow container"><div style={{ maxWidth: 360 }}><DataTable caption="Orders" columns={columns} rows={orders} rowKey={r => r.id} /></div></Block>
    <Block name="KpiStat, KpiRow" tokens="--foreground --muted-foreground --success --destructive"><KpiRow>
      <KpiStat label="Revenue" value="18 420" compare={{ current: 18420, previous: 16100 }} /><KpiStat label="Orders" value="42" compare={{ current: 42, previous: 47 }} /><KpiStat label="Late" value="3" />
    </KpiRow></Block>
    <Block name="ListRow" tokens="--foreground --muted-foreground --accent"><div className="gx-stack">
      {orders.map(o => <ListRow key={o.id} title={o.client} subtitle={`${o.id} · ${o.date}`} trailing={<Badge variant="secondary">{o.status}</Badge>} onSelect={() => undefined} />)}
    </div></Block>
    <Block name="EmptyState" tokens="--muted-foreground --border"><EmptyState title="No orders yet" hint="New orders appear here." action={<Button size="sm">New order</Button>} /></Block>
    <Block name="PageHeader" tokens="--foreground --muted-foreground"><PageHeader title="Orders" badge={<Badge variant="secondary">42</Badge>} actions={<Button size="sm"><Sparkles />Ask</Button>} /></Block>
    <Block name="AppShell and Sidebar" tokens="--sidebar (= canvas) --background --card; real AppShell in its own viewport" className="gx-span">
      <Embed name="shell" height={460} title="AppShell with sidebar" />
    </Block>
  </Section>;
}
