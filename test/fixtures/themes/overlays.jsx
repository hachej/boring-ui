import { createRoot } from 'react-dom/client';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '@/components/ui/alert-dialog';

// D-1799 / D-1800: one open overlay of the real kit primitive. ?kind=sheet|drawer|dialog|alert, ?side=top|right|bottom|left (sheet),
// ?height=auto|tall|full, ?long=1 for content taller than the screen, ?blur=on|<anything> sets <html data-overlay-blur>,
// ?tokens=1 retunes --overlay-height-tall / --overlay-height-full on :root, ?blurpx=<css length> sets --overlay-blur.
const query = new URLSearchParams(location.search);
const root = document.documentElement;
if (query.get('blur')) root.dataset.overlayBlur = query.get('blur');
if (query.get('blurpx')) root.style.setProperty('--overlay-blur', query.get('blurpx'));
if (query.get('tokens')) { root.style.setProperty('--overlay-height-tall', '50dvh'); root.style.setProperty('--overlay-height-full', '70dvh'); }
const height = query.get('height') ?? undefined;
const body = query.get('long') ? Array.from({ length: 60 }, (_, index) => <p key={index}>Ligne {index + 1} du journal</p>) : <p>Un court message</p>;
const kind = query.get('kind') ?? 'dialog';

createRoot(document.getElementById('root')).render(
  kind === 'sheet' ? <Sheet defaultOpen><SheetContent side={query.get('side') ?? 'right'} height={height}><SheetTitle>Journal</SheetTitle>{body}</SheetContent></Sheet>
  : kind === 'drawer' ? <Drawer defaultOpen><DrawerContent height={height}><DrawerTitle>Journal</DrawerTitle><div>{body}</div></DrawerContent></Drawer>
  : kind === 'alert' ? <AlertDialog defaultOpen><AlertDialogContent><AlertDialogTitle>Journal</AlertDialogTitle>{body}</AlertDialogContent></AlertDialog>
  : <Dialog defaultOpen><DialogContent height={height}><DialogTitle>Journal</DialogTitle>{body}</DialogContent></Dialog>,
);
