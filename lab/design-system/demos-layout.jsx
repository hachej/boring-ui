// Components, part 2: layout and content. The kit's real shadcn/ui components, variants read from their cva blocks.
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemHeader, ItemMedia, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileIcon, InfoIcon } from '../../registry/_shared/icons';
import { Demo, Label, groupsOf } from './demo.jsx';

function Alerts() {
  return (
    <Demo names="Alert AlertTitle AlertDescription AlertAction" title="Alert">
      <div className="grid gap-3 lg:grid-cols-2">
        {groupsOf('alert').variant.map(name => (
          <Alert key={name} variant={name} data-ds-variant={name}>
            <InfoIcon />
            <AlertTitle>{name}</AlertTitle>
            <AlertDescription>A message about the workspace.</AlertDescription>
            <AlertAction><Button size="xs" variant="outline">Undo</Button></AlertAction>
          </Alert>
        ))}
      </div>
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

function Tables() {
  return (
    <Demo names="Table TableHeader TableBody TableFooter TableRow TableHead TableCell TableCaption" title="Table">
      <Table>
        <TableCaption>Batches this week.</TableCaption>
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
        <TableFooter><TableRow><TableCell colSpan={4}>2 batches</TableCell></TableRow></TableFooter>
      </Table>
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

function Folds() {
  return (
    <Demo names="Accordion AccordionItem AccordionTrigger AccordionContent Collapsible CollapsibleTrigger CollapsibleContent" title="Accordion and Collapsible">
      <div className="grid gap-4 sm:grid-cols-2">
        <Accordion defaultValue={['one']}>
          <AccordionItem value="one"><AccordionTrigger>First</AccordionTrigger><AccordionContent>Open by default.</AccordionContent></AccordionItem>
          <AccordionItem value="two"><AccordionTrigger>Second</AccordionTrigger><AccordionContent>Closed by default.</AccordionContent></AccordionItem>
        </Accordion>
        <Collapsible defaultOpen>
          <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>Toggle</CollapsibleTrigger>
          <CollapsibleContent>Collapsible content.</CollapsibleContent>
        </Collapsible>
      </div>
    </Demo>
  );
}

function Avatars() {
  return (
    <Demo names="Avatar AvatarImage AvatarFallback AvatarBadge AvatarGroup AvatarGroupCount" title="Avatar">
      <div className="flex flex-wrap items-center gap-4">
        {['sm', 'default', 'lg'].map(size => <Avatar key={size} size={size} data-ds-size={size}><AvatarImage alt="" /><AvatarFallback>AB</AvatarFallback><AvatarBadge /></Avatar>)}
        <AvatarGroup><Avatar><AvatarFallback>AB</AvatarFallback></Avatar><Avatar><AvatarFallback>CD</AvatarFallback></Avatar><AvatarGroupCount>+3</AvatarGroupCount></AvatarGroup>
      </div>
    </Demo>
  );
}

function Navigation() {
  return (
    <Demo names="Breadcrumb BreadcrumbList BreadcrumbItem BreadcrumbLink BreadcrumbPage BreadcrumbSeparator BreadcrumbEllipsis Pagination PaginationContent PaginationItem PaginationLink PaginationPrevious PaginationNext PaginationEllipsis" title="Breadcrumb and Pagination">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="#">Home</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbEllipsis /></BreadcrumbItem><BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Page</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <Pagination>
        <PaginationContent>
          <PaginationItem><PaginationPrevious href="#" /></PaginationItem>
          <PaginationItem><PaginationLink href="#">1</PaginationLink></PaginationItem>
          <PaginationItem><PaginationLink href="#" isActive>2</PaginationLink></PaginationItem>
          <PaginationItem><PaginationEllipsis /></PaginationItem>
          <PaginationItem><PaginationNext href="#" /></PaginationItem>
        </PaginationContent>
      </Pagination>
    </Demo>
  );
}

function Empties() {
  const { variant } = groupsOf('empty');
  return (
    <Demo names="Empty EmptyHeader EmptyMedia EmptyTitle EmptyDescription EmptyContent" title="Empty">
      <div className="grid gap-4 sm:grid-cols-2">
        {variant.map(name => (
          <Empty key={name} data-ds-variant={name}>
            <EmptyHeader><EmptyMedia variant={name}><FileIcon /></EmptyMedia><EmptyTitle>Nothing here</EmptyTitle><EmptyDescription>Add the first file.</EmptyDescription></EmptyHeader>
            <EmptyContent><Button size="sm">Add</Button></EmptyContent>
          </Empty>
        ))}
      </div>
    </Demo>
  );
}

function Items() {
  const { variant, size } = groupsOf('item', 'itemVariants');
  const media = groupsOf('item', 'itemMediaVariants').variant;
  return (
    <Demo names="Item ItemGroup ItemSeparator ItemMedia ItemContent ItemTitle ItemDescription ItemActions ItemHeader ItemFooter" title="Item">
      <div className="grid gap-3 lg:grid-cols-3">
        {variant.map(name => (
          <ItemGroup key={name} data-ds-variant={name}>
            {size.map(sizeName => (
              <Item key={sizeName} variant={name} size={sizeName} data-ds-size={sizeName}>
                <ItemMedia variant={media[size.indexOf(sizeName) % media.length]}><FileIcon /></ItemMedia>
                <ItemContent><ItemTitle>{name} {sizeName}</ItemTitle><ItemDescription>Row description.</ItemDescription></ItemContent>
                <ItemActions><Button size="xs" variant="outline">Open</Button></ItemActions>
              </Item>
            ))}
            <ItemSeparator />
            <Item variant={name}><ItemHeader>Header</ItemHeader><ItemContent><ItemTitle>With header</ItemTitle></ItemContent><ItemFooter>Footer</ItemFooter></Item>
          </ItemGroup>
        ))}
      </div>
    </Demo>
  );
}

function Scrolls() {
  return (
    <Demo names="ScrollArea ScrollBar" title="ScrollArea">
      <ScrollArea className="h-24 w-64 rounded-md border border-border">
        <div className="flex flex-col gap-1 p-3">{Array.from({ length: 12 }, (_, index) => <span key={index}>Line {index + 1}</span>)}</div>
        <ScrollBar />
      </ScrollArea>
    </Demo>
  );
}

export function LayoutDemos() {
  return <><Alerts /><Cards /><Tables /><TabsDemo /><Folds /><Avatars /><Navigation /><Empties /><Items /><Scrolls /></>;
}
