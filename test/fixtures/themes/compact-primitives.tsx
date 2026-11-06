import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../shadcn/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../shadcn/ui/card';
import { Input } from '../../../shadcn/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '../../../shadcn/ui/select';
import { Badge } from '../../../shadcn/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '../../../shadcn/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../shadcn/ui/tabs';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from '../../../shadcn/ui/empty';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../../shadcn/ui/table';
import { Textarea } from '../../../shadcn/ui/textarea';
import { InputGroup, InputGroupTextarea, InputGroupAddon, InputGroupText, InputGroupButton } from '../../../shadcn/ui/input-group';
import { Message, MessageContent } from '../../../shadcn/ui/message';
import { Bubble, BubbleContent } from '../../../shadcn/ui/bubble';
import { Attachment, AttachmentContent, AttachmentTitle, AttachmentDescription } from '../../../shadcn/ui/attachment';
import { Field, FieldLabel, FieldTitle, FieldDescription, FieldError } from '../../../shadcn/ui/field';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../../../shadcn/ui/dropdown-menu';

// Fictional source-owned primitive fixture, not a replacement application layout.
function App() {
  const [clicks, setClicks] = useState(0);
  const items = [{ label: 'Last 7 days', value: 'week' }, { label: 'Last 30 days', value: 'month' }];
  return <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
    <h1 className="text-sm font-semibold">Bundled primitive defaults</h1>
    <p>Fictional workspace · direct shared sources · <span className="font-mono">D-1503</span></p>
    <section className="flex flex-col gap-2" aria-label="Muted text contrast">
      {(['background', 'card', 'muted'] as const).map(surface => <div key={surface} className={({ background: 'bg-background', card: 'bg-card', muted: 'bg-muted' })[surface]} data-testid={`neutral-surface-${surface}`}><FieldDescription data-testid={`neutral-copy-${surface}`}>Fictional secondary guidance</FieldDescription></div>)}
    </section>
    <Card><CardHeader><CardTitle>Weekly marketing report</CardTitle><CardDescription>One surface, with no nested cards</CardDescription></CardHeader>
      <CardContent>Spend is flat; leads are down this week. This copy inherits the Card body default.</CardContent></Card>
    <section className="flex flex-col gap-2" aria-label="Buttons">
      <h2 className="text-sm font-semibold">Actions and sizes</h2>
      <div className="flex flex-wrap items-center gap-2">{(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map(variant => <Button key={variant} variant={variant} data-testid={`button-${variant}`} onClick={() => setClicks(n => n + 1)}>{variant}</Button>)}<Button disabled>Disabled</Button><Button disabled aria-label="Saving"><span aria-hidden="true">◌</span> Saving</Button></div>
      <div className="flex flex-wrap items-center gap-2">{(['xs', 'sm', 'default', 'lg'] as const).map(size => <Button key={size} size={size} data-testid={`size-${size}`}>{size}</Button>)}{(['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const).map(size => <Button key={size} size={size} variant="secondary" aria-label={size}>+</Button>)}</div>
      <output data-testid="clicks">Actions: {clicks}</output>
    </section>
    <section className="grid gap-2 sm:grid-cols-2" aria-label="Fields">
      <label className="flex flex-col gap-1">Name<Input aria-label="Name" defaultValue="Brindille" /></label>
      <label className="flex flex-col gap-1">Email<Input aria-label="Email" aria-invalid="true" defaultValue="fictional@example.test" /></label>
      <label className="flex flex-col gap-1">Disabled<Input aria-label="Disabled field" disabled value="Unavailable" readOnly /></label>
      <div className="flex flex-col gap-1"><span id="period-label">Period</span><Select items={items} defaultValue="week"><SelectTrigger aria-labelledby="period-label"><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
    </section>
    <section className="flex flex-col gap-2" data-testid="ordinary-role-fields" aria-label="Ordinary field and menu roles">
      <Field><FieldLabel htmlFor="role-field">Fictional recipient</FieldLabel><Input id="role-field" /><FieldDescription>Ordinary field guidance</FieldDescription><FieldError>Fictional field error</FieldError></Field>
      <FieldTitle>Checkbox group label</FieldTitle>
      <DropdownMenu><DropdownMenuTrigger render={<Button data-testid="role-menu">Ordinary menu roles</Button>} /><DropdownMenuContent><DropdownMenuGroup>
        <DropdownMenuItem>Ordinary action</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked>Ordinary checkbox choice</DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value="one"><DropdownMenuRadioItem value="one">Ordinary radio choice</DropdownMenuRadioItem></DropdownMenuRadioGroup>
        <DropdownMenuSub><DropdownMenuSubTrigger>Ordinary submenu</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Nested choice</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub>
      </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    </section>
    <section className="flex flex-col gap-2" aria-label="Chat body defaults">
      <h2 className="text-sm font-semibold">Chat copy and editable fields</h2>
      <Textarea data-testid="body-textarea" aria-label="Fictional note" defaultValue="A fictional editable note" />
      <InputGroup><InputGroupTextarea data-testid="body-group-textarea" aria-label="Fictional prompt" defaultValue="A fictional prompt" /><InputGroupAddon align="block-end"><InputGroupText data-testid="body-group-text">Prompt hint</InputGroupText><InputGroupButton data-testid="body-group-button">Send</InputGroupButton></InputGroupAddon></InputGroup>
      <Message data-testid="body-message"><MessageContent><Bubble><BubbleContent data-testid="body-bubble">Fictional message copy</BubbleContent></Bubble></MessageContent></Message>
      <Attachment><AttachmentContent><AttachmentTitle data-testid="body-attachment-title">fictional-report.md</AttachmentTitle><AttachmentDescription data-testid="body-attachment-description">Fictional attachment copy</AttachmentDescription></AttachmentContent></Attachment>
    </section>
    <section className="flex flex-col gap-2" aria-label="Status">
      <h2 className="text-sm font-semibold">Status</h2>
      <div className="flex flex-wrap gap-2">{(['default', 'secondary', 'outline', 'success', 'warning', 'info', 'destructive'] as const).map(variant => <Badge key={variant} variant={variant} data-testid={`badge-${variant}`}>{variant}</Badge>)}</div>
      {(['default', 'success', 'warning', 'info', 'destructive'] as const).map(variant => <Alert key={variant} variant={variant} data-testid={`alert-${variant}`}><AlertTitle>{variant === 'destructive' ? 'No access to this app' : `${variant} notice`}</AlertTitle><AlertDescription>Fictional sample data. Connect an account to see yours.</AlertDescription></Alert>)}
    </section>
    <Tabs defaultValue="overview"><TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList><TabsContent value="overview">Weekly overview</TabsContent><TabsContent value="activity">Recent activity</TabsContent></Tabs>
    <Empty><EmptyHeader><EmptyTitle>Nothing waiting for you</EmptyTitle><EmptyDescription>New requests show up here.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="secondary">New app</Button></EmptyContent></Empty>
    <section className="flex flex-col gap-3" aria-label="Tables"><h2 className="text-sm font-semibold">Tables in 360 / 520 / 720px containers</h2>{[360, 520, 720].map(width => <div key={width} style={{ width, maxWidth: '100%' }} data-table-width={width}><Table aria-label={`Fictional channels ${width}`}><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Spend</TableHead><TableHead>Owner / identifier</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Paid search</TableCell><TableCell>€721</TableCell><TableCell>Fictional category</TableCell></TableRow><TableRow><TableCell>Paid social</TableCell><TableCell>€840</TableCell><TableCell>fictional-long-unbroken-identifier-0123456789abcdefghijklmnopqrstuvwxyz</TableCell></TableRow></TableBody></Table></div>)}</section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
