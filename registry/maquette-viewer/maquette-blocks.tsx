'use client';

// One maquette screen drawn from the host's own shadcn components: each catalogue type is a real Button, Input, NativeSelect, Badge, Table,
// Item, Card or Bubble, so a mock-up looks like the app it announces. A type the catalogue does not know becomes a named placeholder
// (an Empty in a Card). `go` is set in play mode only: goto blocks then open their screen; elsewhere the screen is a still picture.
import type { ReactNode, Ref } from 'react';
import { BoxIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Maquette, MaquetteBlock, MaquetteScreen } from './maquette';
import type { MaquetteLabels } from './maquette-labels';

/** Opens a screen by id (play mode). */
export type MaquetteGo = (screen: string) => void;

const SKELETON = [92, 100, 64];

function Placeholder({ block, go, labels }: { readonly block: MaquetteBlock; readonly go: MaquetteGo | undefined; readonly labels: MaquetteLabels }) {
  return <Card size="sm" data-testid="maquette-placeholder" data-type={block.type}>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><BoxIcon aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{block.label || block.type}</EmptyTitle>
        <EmptyDescription>{block.note || labels.unknownBlock}</EmptyDescription>
      </EmptyHeader>
      {block.goto && <EmptyContent><GotoButton block={block} go={go} label={block.label || block.type} /></EmptyContent>}
    </Empty>
  </Card>;
}

function GotoButton({ block, go, label }: { readonly block: MaquetteBlock; readonly go: MaquetteGo | undefined; readonly label: string }) {
  const target = block.goto;
  return <Button type="button" variant={block.type === 'link' ? 'link' : block.primary ? 'default' : 'outline'} className="w-fit max-w-full pointer-coarse:min-h-11"
    data-testid={target ? 'maquette-goto' : 'maquette-button'} data-goto={target} onClick={() => { if (target) go?.(target); }}>
    <span className="truncate">{label || '…'}</span>
  </Button>;
}

/** One block and its children. */
export function MaquetteBlockView({ block, go, labels }: { readonly block: MaquetteBlock; readonly go: MaquetteGo | undefined; readonly labels: MaquetteLabels }): ReactNode {
  const children = block.children.map((child, index) => <MaquetteBlockView key={index} block={child} go={go} labels={labels} />);
  switch (block.type) {
    case 'heading': return <h4 className="m-0 text-base font-semibold text-balance">{block.label}</h4>;
    case 'text': return <p className="m-0 text-sm text-pretty text-muted-foreground">{block.label}</p>;
    case 'button': case 'link': return <GotoButton block={block} go={go} label={block.label} />;
    case 'input': return <Label className="flex-col items-stretch gap-1.5">{block.label}
      <Input className="pointer-coarse:min-h-11" placeholder={block.placeholder} defaultValue={block.value} readOnly={!go} /></Label>;
    case 'select': return <Label className="flex-col items-stretch gap-1.5">{block.label}
      <NativeSelect className="w-full pointer-coarse:min-h-11" defaultValue={block.value} disabled={!go}>
        {(block.items.length ? block.items : [block.value || block.placeholder || '…']).map((option, index) => <NativeSelectOption key={index} value={option}>{option}</NativeSelectOption>)}
      </NativeSelect></Label>;
    case 'badge': return <Badge variant="secondary">{block.label}</Badge>;
    case 'list': return <ItemGroup className="gap-2">
      {block.label && <p className="m-0 text-sm font-medium">{block.label}</p>}
      {block.items.map((item, index) => <Item key={index} variant="outline" size="sm"><ItemContent><ItemTitle>{item}</ItemTitle></ItemContent></Item>)}
    </ItemGroup>;
    case 'table': return <div className="min-w-0 overflow-x-auto"><Table>
      <TableHeader><TableRow>{block.columns.map((column, index) => <TableHead key={index}>{column}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{block.rows.map((row, index) => <TableRow key={index}>{row.map((cell, column) => <TableCell key={column}>{cell}</TableCell>)}</TableRow>)}</TableBody>
    </Table></div>;
    case 'card': return <Card size="sm">
      {block.label && <CardHeader><CardTitle>{block.label}</CardTitle></CardHeader>}
      {children.length > 0 && <CardContent className="flex flex-col gap-3">{children}</CardContent>}
    </Card>;
    case 'row': return <div className="flex flex-wrap items-start gap-3 *:min-w-40 *:flex-1">{children}</div>;
    case 'stack': return <div className="flex flex-col gap-3">{children}</div>;
    case 'chat': return <Card size="sm">
      {block.label && <CardHeader><CardTitle>{block.label}</CardTitle></CardHeader>}
      <CardContent className="flex flex-col gap-2">
        {block.messages.map((message, index) => <Bubble key={index} align={message.mine ? 'end' : 'start'} variant={message.mine ? 'default' : 'muted'}><BubbleContent>{message.text}</BubbleContent></Bubble>)}
        <Input className="pointer-coarse:min-h-11" placeholder={block.placeholder || '…'} readOnly={!go} aria-label={block.placeholder || block.label || 'chat'} />
        {children}
      </CardContent>
    </Card>;
    case 'document': return <Card size="sm">
      {block.label && <CardHeader><CardTitle>{block.label}</CardTitle></CardHeader>}
      <CardContent className="flex flex-col gap-2">
        {block.lines.length ? block.lines.map((line, index) => <p key={index} className="m-0 text-sm text-muted-foreground">{line}</p>)
          : SKELETON.map(width => <span key={width} aria-hidden="true" className="block h-2 bg-muted" style={{ width: `${width}%` }} />)}
        {children}
      </CardContent>
    </Card>;
    case 'placeholder': default: return <Placeholder block={block} go={go} labels={labels} />;
  }
}

/** A screen as the app would show it: the app's navigation bar (when the maquette has one), the screen's name, then its blocks. */
export function MaquetteScreenView({ maquette, screen, go, labels, headingRef }: {
  readonly maquette: Maquette; readonly screen: MaquetteScreen; readonly go: MaquetteGo | undefined; readonly labels: MaquetteLabels;
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
}) {
  return <div data-testid="maquette-screen" data-screen={screen.id} className="flex min-w-0 flex-col gap-4">
    {maquette.nav.length > 0 && <>
      <nav aria-label={labels.appNavigation} className="flex flex-wrap gap-1">
        {maquette.nav.map(item => <Button key={item.goto} type="button" size="sm" variant={item.goto === screen.id ? 'secondary' : 'ghost'} className="pointer-coarse:min-h-11"
          aria-current={item.goto === screen.id ? 'page' : undefined} data-testid="maquette-nav" onClick={() => go?.(item.goto)}>{item.label}</Button>)}
      </nav>
      <Separator />
    </>}
    <h3 ref={headingRef} tabIndex={-1} className="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none">{screen.title}</h3>
    {screen.blocks.map((block, index) => <MaquetteBlockView key={index} block={block} go={go} labels={labels} />)}
  </div>;
}
