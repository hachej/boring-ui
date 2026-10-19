'use client';

// One maquette screen drawn from the host's own shadcn components: each catalogue type is a real Button, Input, NativeSelect, Badge, Table,
// Item, Card or Bubble, so a mock-up looks like the app it announces. A type the catalogue does not know becomes a named placeholder
// (a grey dashed Empty). Blocks with a goto open their screen; the item's CSS gives them a soft ring on hover and focus. Each block sits
// in a box marked `data-feedback-id` (the maquette path, screen id and block id), so a note pinned on it with the feedback item's point mode
// says exactly which block it is about; the screen is a `data-feedback-visible` region, so the block's words go with the note.
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

/** Opens a screen by id. */
export type MaquetteGo = (screen: string) => void;
/**
 * How a block reaches other screens: `go` opens one, `hint` names where a goto leads (the button's tooltip). `target` is a block's
 * `data-feedback-id` and `pins` the numbers of the comment pins on it (none while point mode draws its own).
 */
export interface MaquetteLinks {
  readonly go: MaquetteGo;
  readonly hint: (screen: string) => string;
  readonly target: (block: MaquetteBlock) => string;
  readonly pins: (block: MaquetteBlock) => readonly number[];
}

const SKELETON = [92, 100, 64];

function Placeholder({ block, links, labels }: { readonly block: MaquetteBlock; readonly links: MaquetteLinks; readonly labels: MaquetteLabels }) {
  return <div data-testid="maquette-placeholder" data-type={block.type}>
    <Empty data-maquette="placeholder">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BoxIcon aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{block.label || block.type}</EmptyTitle>
        <EmptyDescription>{block.note || labels.unknownBlock}</EmptyDescription>
      </EmptyHeader>
      {block.goto && <EmptyContent><GotoButton block={block} links={links} label={block.label || block.type} /></EmptyContent>}
    </Empty>
  </div>;
}

// A block with a goto opens its screen (its tooltip names it); one without is drawn but does nothing.
function GotoButton({ block, links, label }: { readonly block: MaquetteBlock; readonly links: MaquetteLinks; readonly label: string }) {
  const target = block.goto;
  return <Button type="button" variant={block.type === 'link' ? 'link' : block.primary ? 'default' : 'outline'} className="w-fit max-w-full pointer-coarse:min-h-11"
    data-testid={target ? 'maquette-goto' : 'maquette-button'} data-goto={target} title={target ? links.hint(target) : undefined} onClick={() => { if (target) links.go(target); }}>
    <span className="truncate">{label || '…'}</span>
  </Button>;
}

/** One block and its children, in its marked box with its comment pins. */
export function MaquetteBlockView({ block, links, labels }: { readonly block: MaquetteBlock; readonly links: MaquetteLinks; readonly labels: MaquetteLabels }): ReactNode {
  const pins = links.pins(block);
  return <div data-testid="maquette-block" data-block={block.id} data-feedback-id={links.target(block)} className="relative min-w-0">
    <BlockBody block={block} links={links} labels={labels} />
    {pins.length > 0 && <Badge data-testid="maquette-pin" data-feedback-ignore="" aria-hidden="true" className="absolute -top-2 -left-2 tabular-nums">{pins.join(' ')}</Badge>}
  </div>;
}

function BlockBody({ block, links, labels }: { readonly block: MaquetteBlock; readonly links: MaquetteLinks; readonly labels: MaquetteLabels }): ReactNode {
  const children = block.children.map((child, index) => <MaquetteBlockView key={index} block={child} links={links} labels={labels} />);
  switch (block.type) {
    case 'heading': return <h4 className="m-0 text-base font-semibold text-balance">{block.label}</h4>;
    case 'text': return <p className="m-0 text-sm text-pretty text-muted-foreground">{block.label}</p>;
    case 'button': case 'link': return <GotoButton block={block} links={links} label={block.label} />;
    case 'input': return <Label className="flex-col items-stretch gap-1.5">{block.label}
      <Input className="pointer-coarse:min-h-11" placeholder={block.placeholder} defaultValue={block.value} /></Label>;
    case 'select': return <Label className="flex-col items-stretch gap-1.5">{block.label}
      <NativeSelect className="w-full pointer-coarse:[&_select]:min-h-11" defaultValue={block.value}>
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
        <Input className="pointer-coarse:min-h-11" placeholder={block.placeholder || '…'} aria-label={block.placeholder || block.label || 'chat'} />
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
    case 'placeholder': default: return <Placeholder block={block} links={links} labels={labels} />;
  }
}

/** A screen as the app would show it: the app's navigation bar (when the maquette has one), then its blocks. Its name is for screen readers and focus. */
export function MaquetteScreenView({ maquette, screen, links, labels, headingRef }: {
  readonly maquette: Maquette; readonly screen: MaquetteScreen; readonly links: MaquetteLinks; readonly labels: MaquetteLabels;
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
}) {
  return <div data-testid="maquette-screen" data-screen={screen.id} data-feedback-visible="" className="flex min-w-0 flex-col gap-4">
    {maquette.nav.length > 0 && <>
      <nav aria-label={labels.appNavigation} className="flex flex-wrap gap-1">
        {maquette.nav.map(item => <Button key={item.goto} type="button" size="sm" variant={item.goto === screen.id ? 'secondary' : 'ghost'} className="pointer-coarse:min-h-11"
          aria-current={item.goto === screen.id ? 'page' : undefined} data-testid="maquette-nav" title={links.hint(item.goto)} onClick={() => links.go(item.goto)}>{item.label}</Button>)}
      </nav>
      <Separator />
    </>}
    <h3 ref={headingRef} tabIndex={-1} data-testid="maquette-screen-title" className="sr-only">{screen.title}</h3>
    {screen.blocks.map((block, index) => <MaquetteBlockView key={index} block={block} links={links} labels={labels} />)}
  </div>;
}
