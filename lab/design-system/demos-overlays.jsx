// Components, part 4: overlays and the app shell. Each overlay is the kit's real component, open and contained in a bounded box (a static frame).
// AlertDialog is always modal in Base UI (scroll lock, inert siblings), so it lives in its own cell: an iframe of this same file.
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerOverlay, DrawerPortal, DrawerSwipeHandle, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Cell } from './cell.jsx';
import { Demo, Framed, QUIET, STATIC } from './demo.jsx';

const HEIGHTS = ['auto', 'tall', 'full'];

function Dialogs() {
  return (
    <Demo names="Dialog DialogPortal DialogOverlay DialogTrigger DialogClose DialogContent DialogHeader DialogTitle DialogDescription DialogFooter" title="Dialog">
      <div className="grid gap-3 lg:grid-cols-3">
        {HEIGHTS.map(height => (
          <Framed key={height} id={`dialog-${height}`} caption={`height="${height}"`}>
            <Dialog {...STATIC}>
              <DialogTrigger render={<Button size="sm" className="m-2" />}>Open</DialogTrigger>
              <DialogContent height={height} data-ds-overlay={`dialog-${height}`} {...QUIET}>
                <DialogHeader><DialogTitle>Dialog</DialogTitle><DialogDescription>A static frame of the open dialog.</DialogDescription></DialogHeader>
                <DialogFooter><DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose><Button size="sm">Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </Framed>
        ))}
      </div>
    </Demo>
  );
}

function Sheets() {
  return (
    <Demo names="Sheet SheetTrigger SheetClose SheetContent SheetHeader SheetTitle SheetDescription SheetFooter" title="Sheet">
      <div className="grid gap-3 lg:grid-cols-3">
        {HEIGHTS.map(height => (
          <Framed key={height} id={`sheet-${height}`} caption={`height="${height}", side bottom`}>
            <Sheet {...STATIC}>
              <SheetTrigger render={<Button size="sm" className="m-2" />}>Open</SheetTrigger>
              <SheetContent side="bottom" height={height} data-ds-overlay={`sheet-${height}`} {...QUIET}>
                <SheetHeader><SheetTitle>Sheet</SheetTitle><SheetDescription>A static frame of the open sheet.</SheetDescription></SheetHeader>
                <SheetFooter><SheetClose render={<Button variant="outline" size="sm" />}>Close</SheetClose><Button size="sm">Save</Button></SheetFooter>
              </SheetContent>
            </Sheet>
          </Framed>
        ))}
      </div>
    </Demo>
  );
}

function Drawers() {
  return (
    <Demo names="Drawer DrawerPortal DrawerOverlay DrawerTrigger DrawerClose DrawerContent DrawerHeader DrawerTitle DrawerDescription DrawerFooter DrawerSwipeHandle" title="Drawer">
      <Framed id="drawer" caption="swipeDirection down, not modal">
        <Drawer open modal={false} showSwipeHandle onOpenChange={() => {}}>
          <DrawerTrigger render={<Button size="sm" className="m-2" />}>Open</DrawerTrigger>
          <DrawerContent data-ds-overlay="drawer">
            <DrawerHeader><DrawerTitle>Drawer</DrawerTitle><DrawerDescription>A static frame of the open drawer.</DrawerDescription></DrawerHeader>
            <DrawerFooter><DrawerClose render={<Button variant="outline" size="sm" />}>Close</DrawerClose></DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Framed>
    </Demo>
  );
}

function Floating() {
  return (
    <Demo names="Popover PopoverTrigger PopoverContent PopoverHeader PopoverTitle PopoverDescription Tooltip TooltipProvider TooltipTrigger TooltipContent" title="Popover and Tooltip">
      <div className="grid gap-3 lg:grid-cols-2">
        <Framed id="popover" caption="open popover" height={240}>
          <Popover open modal={false} onOpenChange={() => {}}>
            <PopoverTrigger render={<Button size="sm" variant="outline" className="m-2" />}>Popover</PopoverTrigger>
            <PopoverContent data-ds-overlay="popover" {...QUIET}>
              <PopoverHeader><PopoverTitle>Popover</PopoverTitle><PopoverDescription>Anchored to its trigger.</PopoverDescription></PopoverHeader>
            </PopoverContent>
          </Popover>
        </Framed>
        <Framed id="tooltip" caption="open tooltip" height={240}>
          <TooltipProvider>
            <Tooltip open>
              <TooltipTrigger render={<Button size="sm" variant="outline" className="m-2 mt-16" />}>Tooltip</TooltipTrigger>
              <TooltipContent data-ds-overlay="tooltip">Tooltip text</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Framed>
      </div>
    </Demo>
  );
}

function Menus() {
  return (
    <Demo names="DropdownMenu DropdownMenuPortal DropdownMenuTrigger DropdownMenuContent DropdownMenuGroup DropdownMenuLabel DropdownMenuItem DropdownMenuCheckboxItem DropdownMenuRadioGroup DropdownMenuRadioItem DropdownMenuSeparator DropdownMenuShortcut DropdownMenuSub DropdownMenuSubTrigger DropdownMenuSubContent" title="Dropdown menu">
      <Framed id="menu" caption="open menu with its submenu" height={300}>
        <DropdownMenu open modal={false} onOpenChange={() => {}}>
          <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="m-2" />}>Menu</DropdownMenuTrigger>
          <DropdownMenuContent data-ds-overlay="menu" {...QUIET}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem>Profile<DropdownMenuShortcut>Ctrl P</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuCheckboxItem checked>Notifications</DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value="a"><DropdownMenuRadioItem value="a">Draft</DropdownMenuRadioItem><DropdownMenuRadioItem value="b">Review</DropdownMenuRadioItem></DropdownMenuRadioGroup>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent data-ds-overlay="menu:sub"><DropdownMenuItem>Sub item</DropdownMenuItem></DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </Framed>
    </Demo>
  );
}

function Selects() {
  return (
    <Demo names="Select SelectTrigger SelectValue SelectContent SelectGroup SelectLabel SelectItem SelectSeparator SelectScrollUpButton SelectScrollDownButton" title="Select">
      <div className="flex flex-wrap items-center gap-3">
        {['default', 'sm'].map(size => (
          <Select key={size} defaultValue="Draft">
            <SelectTrigger size={size} aria-label={`Select ${size}`} data-ds-size={size}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="Draft">Draft</SelectItem><SelectItem value="Review">Review</SelectItem></SelectContent>
          </Select>
        ))}
      </div>
      <Framed id="select" caption="open select" height={260}>
        <Select open modal={false} defaultValue="Draft" onOpenChange={() => {}}>
          <SelectTrigger aria-label="Open select" className="m-2 w-48"><SelectValue /></SelectTrigger>
          <SelectContent alignItemWithTrigger={false} data-ds-overlay="select" {...QUIET}>
            <SelectGroup><SelectLabel>Status</SelectLabel><SelectItem value="Draft">Draft</SelectItem><SelectSeparator /><SelectItem value="Review">Review</SelectItem></SelectGroup>
          </SelectContent>
        </Select>
      </Framed>
    </Demo>
  );
}

function Alerts() {
  return (
    <Demo
      title="Alert dialog"
      note="Always modal (it locks scroll and makes the page inert), so each size is shown in its own frame."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {['default', 'sm'].map(size => <Cell key={size} id={`alertdialog-${size}`} caption={`size="${size}"`} />)}
      </div>
    </Demo>
  );
}

export function OverlayDemos() {
  return <><Dialogs /><Sheets /><Drawers /><Floating /><Menus /><Selects /><Alerts /></>;
}
