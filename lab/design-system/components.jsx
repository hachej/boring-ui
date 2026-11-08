// Section 6: components. The real shadcn/ui primitives of this kit, every variant and size read from the components' own cva blocks (data.js),
// each demo marked data-ds-component. Exports with no demo are listed at the end, never hidden.
import { useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PlusIcon } from '../../registry/_shared/icons';

const data = globalThis.BORING_DS;
/** The cva dimensions of a component file, merged: { variant: [...], size: [...] }. */
const groupsOf = file => Object.assign({}, ...(data.components[file]?.variants ?? []).map(entry => entry.groups));

function Demo({ names, title, children }) {
  return (
    <div data-ds-component={names} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </div>
  );
}
const Label = ({ children }) => <code className="text-muted-foreground">{children}</code>;

function Buttons() {
  const { variant, size } = groupsOf('button');
  const plain = size.filter(name => !name.startsWith('icon') && name !== 'inline');
  const icons = size.filter(name => name.startsWith('icon'));
  return (
    <Demo names="Button" title="Button">
      <div className="flex flex-col gap-2">
        {variant.map(name => (
          <div key={name} data-ds-variant={name} className="flex flex-wrap items-center gap-2">
            <Label>{name}</Label>
            {plain.map(sizeName => <Button key={sizeName} variant={name} size={sizeName}>{sizeName}</Button>)}
            {icons.map(sizeName => <Button key={sizeName} variant={name} size={sizeName} aria-label={`${name} ${sizeName}`}><PlusIcon /></Button>)}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2" data-ds-size="inline">
        <p className="max-w-prose">Sentence with an inline action: read the <Button variant="link" size="inline">release notes</Button> before you upgrade.</p>
        <Table><TableBody><TableRow><TableCell>Row with an inline action</TableCell><TableCell><Button variant="link" size="inline">Open</Button></TableCell></TableRow></TableBody></Table>
      </div>
    </Demo>
  );
}

function Badges() {
  return (
    <Demo names="Badge" title="Badge">
      <div className="flex flex-wrap items-center gap-2">
        {groupsOf('badge').variant.map(name => <Badge key={name} variant={name} data-ds-variant={name}>{name}</Badge>)}
      </div>
    </Demo>
  );
}

function Inputs() {
  return (
    <Demo names="Input Textarea" title="Input and Textarea">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input aria-label="Text input" placeholder="Input" />
        <Input aria-label="Invalid input" aria-invalid="true" defaultValue="Invalid" />
        <Input aria-label="Disabled input" disabled defaultValue="Disabled" />
        <Textarea aria-label="Textarea" placeholder="Textarea" />
        <Textarea aria-label="Code textarea" variant="code" defaultValue={'{ "kind": "code", "tab": 2 }'} data-ds-variant="code" />
      </div>
    </Demo>
  );
}

function Selects() {
  return (
    <Demo names="Select SelectTrigger SelectValue SelectContent SelectItem" title="Select">
      <div className="flex flex-wrap items-center gap-3">
        {['default', 'sm'].map(size => (
          <Select key={size} defaultValue="Draft">
            <SelectTrigger size={size} aria-label={`Select ${size}`} data-ds-size={size}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="Draft">Draft</SelectItem><SelectItem value="Review">Review</SelectItem></SelectContent>
          </Select>
        ))}
      </div>
    </Demo>
  );
}

function Toggles() {
  return (
    <Demo names="Checkbox Switch" title="Checkbox and Switch">
      <div className="flex flex-wrap items-center gap-4">
        <Checkbox aria-label="Unchecked" /><Checkbox aria-label="Checked" defaultChecked /><Checkbox aria-label="Disabled" disabled />
        {['default', 'sm'].map(size => <Switch key={size} size={size} aria-label={`Switch ${size}`} defaultChecked data-ds-size={size} />)}
        <Switch aria-label="Switch off" /><Switch aria-label="Switch disabled" disabled />
      </div>
    </Demo>
  );
}

function TabsDemo() {
  return (
    <Demo names="Tabs TabsList TabsTrigger TabsContent" title="Tabs">
      <div className="flex flex-wrap gap-6">
        {groupsOf('tabs').variant.map(variant => (
          <Tabs key={variant} defaultValue="one" data-ds-variant={variant}>
            <TabsList variant={variant}><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList>
            <TabsContent value="one"><Label>{variant}</Label></TabsContent>
            <TabsContent value="two">Second</TabsContent>
          </Tabs>
        ))}
      </div>
    </Demo>
  );
}

function Tables() {
  return (
    <Demo names="Table TableHeader TableBody TableRow TableHead TableCell" title="Table">
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Note</TableHead><TableHead>Link</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Alpha batch</TableCell>
            <TableCell><Badge variant="success">ready</Badge></TableCell>
            <TableCell truncate>A long note that does not fit on a single line of this narrow cell and ends in an ellipsis</TableCell>
            <TableCell><Button variant="link" size="inline">Open</Button></TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Beta batch</TableCell>
            <TableCell><Badge variant="warning">waiting</Badge></TableCell>
            <TableCell truncate>Short note</TableCell>
            <TableCell><Button variant="link" size="inline">Open</Button></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Demo>
  );
}

function Cards() {
  return (
    <Demo names="Card CardHeader CardTitle CardDescription CardAction CardContent CardFooter" title="Card">
      <Card className="max-w-sm">
        <CardHeader><CardTitle>Card title</CardTitle><CardDescription>Supporting description</CardDescription><CardAction><Badge variant="info">new</Badge></CardAction></CardHeader>
        <CardContent>Content of the card.</CardContent>
        <CardFooter><Button size="sm">Action</Button></CardFooter>
      </Card>
    </Demo>
  );
}

function Fields() {
  return (
    <Demo names="Field FieldLabel FieldContent FieldTitle FieldDescription FieldGroup" title="Field rows">
      <div className="grid gap-4 sm:grid-cols-2">
        {['flat', 'bordered'].map(variant => (
          <FieldGroup key={variant} className="gap-0" data-ds-variant={variant}>
            <FieldLabel variant={variant}>
              <Field orientation="horizontal">
                <FieldContent><FieldTitle>Notifications ({variant})</FieldTitle><FieldDescription>A row with a switch.</FieldDescription></FieldContent>
                <Switch aria-label={`Notifications ${variant}`} defaultChecked />
              </Field>
            </FieldLabel>
            <FieldLabel variant={variant}>
              <Field orientation="horizontal">
                <FieldContent><FieldTitle>Digest ({variant})</FieldTitle><FieldDescription>A row with a checkbox.</FieldDescription></FieldContent>
                <Checkbox aria-label={`Digest ${variant}`} />
              </Field>
            </FieldLabel>
          </FieldGroup>
        ))}
      </div>
    </Demo>
  );
}

/** A bounded box for an overlay: the transform makes it the containing block of `position: fixed`, and the portal host is moved into it. */
function Bounded({ id, height = 360, children }) {
  const box = useRef(null);
  useLayoutEffect(() => {
    const place = () => {
      let node = document.querySelector(`[data-ds-overlay="${id}"]`);
      if (!node || box.current.contains(node)) return;
      while (node.parentElement && node.parentElement !== document.body) node = node.parentElement;
      if (node.parentElement === document.body) box.current.appendChild(node);
    };
    place();
    const watch = new MutationObserver(place);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [id]);
  const style = { height, transform: 'translateZ(0)', '--overlay-height-tall': `${Math.round(height * 0.85)}px`, '--overlay-height-full': `${height}px` };
  return (
    <div ref={box} data-ds-bounded={id} className="relative overflow-hidden rounded-lg border border-border bg-muted" style={style}>
      {children}
    </div>
  );
}

const STATIC = { modal: false, open: true, onOpenChange: () => {} };
const QUIET = { initialFocus: false, finalFocus: false };

function Overlays() {
  const heights = ['auto', 'tall', 'full'];
  return (
    <>
      <Demo names="Dialog DialogPortal DialogOverlay DialogContent DialogHeader DialogTitle DialogDescription DialogFooter" title="Dialog">
        <div className="grid gap-3 lg:grid-cols-3">
          {heights.map(height => (
            <div key={height} data-ds-height={height} className="flex flex-col gap-1">
              <Label>height="{height}"</Label>
              <Bounded id={`dialog-${height}`}>
                <Dialog {...STATIC}>
                  <DialogContent height={height} data-ds-overlay={`dialog-${height}`} {...QUIET}>
                    <DialogHeader><DialogTitle>Dialog</DialogTitle><DialogDescription>A static frame of the open dialog.</DialogDescription></DialogHeader>
                    <DialogFooter><Button variant="outline" size="sm">Cancel</Button><Button size="sm">Save</Button></DialogFooter>
                  </DialogContent>
                </Dialog>
              </Bounded>
            </div>
          ))}
        </div>
      </Demo>
      <Demo names="Sheet SheetPortal SheetOverlay SheetContent SheetHeader SheetTitle SheetDescription SheetFooter" title="Sheet">
        <div className="grid gap-3 lg:grid-cols-3">
          {heights.map(height => (
            <div key={height} data-ds-height={height} className="flex flex-col gap-1">
              <Label>height="{height}", side bottom</Label>
              <Bounded id={`sheet-${height}`}>
                <Sheet {...STATIC}>
                  <SheetContent side="bottom" height={height} data-ds-overlay={`sheet-${height}`} {...QUIET}>
                    <SheetHeader><SheetTitle>Sheet</SheetTitle><SheetDescription>A static frame of the open sheet.</SheetDescription></SheetHeader>
                    <SheetFooter><Button size="sm">Save</Button></SheetFooter>
                  </SheetContent>
                </Sheet>
              </Bounded>
            </div>
          ))}
        </div>
      </Demo>
    </>
  );
}

function Toast() {
  return (
    <Demo names="Toaster" title="Toast">
      <div data-ds-state="static" role="status" className="flex w-80 items-start gap-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
        <div className="flex flex-col gap-0.5"><span className="font-medium">Saved</span><span className="text-muted-foreground">The change is in the workspace.</span></div>
        <Button variant="ghost" size="xs" className="ml-auto">Undo</Button>
      </div>
      <p className="text-muted-foreground">Static: the toast renderer (sonner) is not part of the page's bundle, so this frame draws the toast with the same tokens.</p>
    </Demo>
  );
}

/** Exports no demo marks: listed so nothing is silently missing. */
function Listed() {
  const root = useRef(null);
  const [names, setNames] = useState([]);
  useLayoutEffect(() => {
    const rendered = new Set();
    for (const node of document.querySelectorAll('[data-ds-component]')) for (const name of node.getAttribute('data-ds-component').split(/\s+/)) rendered.add(name);
    setNames(Object.values(data.components).flatMap(file => file.exports).filter(name => !rendered.has(name)));
  }, []);
  return (
    <div ref={root} className="flex flex-col gap-2" data-ds-listed-block>
      <h3 className="text-base font-semibold">Listed, not rendered</h3>
      <p className="text-muted-foreground">Exports of the kit's shadcn/ui files that this page has no demo for yet.</p>
      <div className="flex flex-wrap gap-1">{names.map(name => <code key={name} data-ds-listed={name} className="rounded-sm bg-muted px-1 text-muted-foreground">{name}</code>)}</div>
    </div>
  );
}

export function Components() {
  return (
    <section data-ds-section="components" className="flex flex-col gap-8">
      <h2 className="text-xl font-semibold">Components</h2>
      <Buttons /><Badges /><Inputs /><Selects /><Toggles /><TabsDemo /><Tables /><Cards /><Fields /><Overlays /><Toast /><Listed />
    </section>
  );
}
