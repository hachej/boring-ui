import { useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckIcon, PlusIcon, SendIcon } from '../../../registry/_shared/icons.ts';
import { Grid, Page, Specimen } from '../common.jsx';

const BUTTONS = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'];
const BADGES = ['default', 'secondary', 'success', 'warning', 'info', 'destructive', 'outline'];
const FIELD = 'flex w-full flex-col gap-1.5';

/** The kit's toast is sonner's, which this page does not load: this is the same message on a kit Alert, shown for a few seconds. */
function ToastDemo() {
  const [toasts, setToasts] = useState([]);
  const next = useRef(0);
  const push = variant => {
    next.current += 1;
    const id = next.current;
    setToasts(list => [...list, { id, variant }]);
    setTimeout(() => setToasts(list => list.filter(entry => entry.id !== id)), 3500);
  };
  return <>
    <Button variant="outline" onClick={() => push('success')}>Succès</Button>
    <Button variant="outline" onClick={() => push('warning')}>Attention</Button>
    <Button variant="outline" onClick={() => push('destructive')}>Erreur</Button>
    <div role="status" aria-live="polite" data-testid="toast-stack" className="pointer-events-none fixed right-4 bottom-24 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map(({ id, variant }) => <Alert key={id} variant={variant} className="bg-popover">
        <CheckIcon />
        <AlertTitle>{variant === 'success' ? 'Enregistré' : variant === 'warning' ? 'Presque plein' : 'Envoi impossible'}</AlertTitle>
        <AlertDescription>{variant === 'success' ? 'Le carnet de la semaine est à jour.' : variant === 'warning' ? 'Il reste 2 Go sur cet espace.' : 'Réessayez dans un instant.'}</AlertDescription>
      </Alert>)}
    </div>
  </>;
}

/** The Select's items are the label and the value of a fictional week. */
function SelectDemo() {
  const [value, setValue] = useState('lundi');
  return <div className={FIELD}>
    <Label htmlFor="gallery-jour">Jour du marché</Label>
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger id="gallery-jour" className="w-full"><SelectValue placeholder="Choisir un jour" /></SelectTrigger>
      <SelectContent>
        {['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'].map(day => <SelectItem key={day} value={day}>{day}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}

export function Bases() {
  return <Page id="bases" title="Bases" description="Les composants de base du kit, dans son style par défaut : chaque variante, taille et état.">
    <Grid>
      <Specimen id="button-variants" title="Bouton : variantes" description="Six variantes ; une seule action principale par écran.">
        {BUTTONS.map(variant => <Button key={variant} variant={variant}>{variant}</Button>)}
      </Specimen>
      <Specimen id="button-sizes" title="Bouton : tailles" description="La hauteur suit la densité et le pointeur (44 px au doigt).">
        <Button size="xs">xs</Button>
        <Button size="sm">sm</Button>
        <Button>défaut</Button>
        <Button size="lg">lg</Button>
        <Button size="icon" aria-label="Ajouter"><PlusIcon /></Button>
        <span>Un <Button size="inline" variant="link">lien dans une phrase</Button>.</span>
      </Specimen>
      <Specimen id="button-states" title="Bouton : états" description="Chargement, désactivé, avec icône.">
        <Button disabled><Spinner data-icon="inline-start" />Envoi en cours</Button>
        <Button variant="outline" disabled>Désactivé</Button>
        <Button><SendIcon data-icon="inline-start" />Envoyer</Button>
        <Button variant="secondary">Suivant<PlusIcon data-icon="inline-end" /></Button>
      </Specimen>
      <Specimen id="badges" title="Badge" description="Un état en un mot ; la couleur suit le sens, jamais la décoration.">
        {BADGES.map(variant => <Badge key={variant} variant={variant}>{variant}</Badge>)}
      </Specimen>
      <Specimen id="fields" title="Champs" description="Texte sur une ligne, plusieurs lignes, et le champ de code pour du brut collé.">
        <div className={FIELD}>
          <Label htmlFor="gallery-nom">Nom du carnet</Label>
          <Input id="gallery-nom" placeholder="Semaine du marché" />
        </div>
        <div className={FIELD}>
          <Input aria-label="Champ désactivé" disabled placeholder="Désactivé" />
        </div>
        <div className={FIELD}>
          <Label htmlFor="gallery-note">Note</Label>
          <Textarea id="gallery-note" placeholder="Une note libre pour l'équipe" />
        </div>
        <div className={FIELD}>
          <Label htmlFor="gallery-json">Charge brute</Label>
          <Textarea id="gallery-json" variant="code" defaultValue={'{ "fictif": true, "pains": 3 }'} />
        </div>
      </Specimen>
      <Specimen id="choices" title="Choix" description="Liste déroulante, case à cocher et interrupteur.">
        <SelectDemo />
        <Label className="w-full"><Checkbox defaultChecked />Garder les brouillons</Label>
        <Label className="w-full"><Checkbox />Prévenir l'équipe</Label>
        <Label className="w-full"><Switch defaultChecked />Notifications</Label>
        <Label className="w-full"><Switch disabled />Mode avion (indisponible)</Label>
      </Specimen>
      <Specimen id="tooltip" title="Infobulle" description="Au survol ou au clavier ; elle ne porte jamais l'information seule.">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>Survolez-moi</TooltipTrigger>
            <TooltipContent>Une aide courte</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Specimen>
      <Specimen id="overlays" title="Dialogue, panneau, popover" description="Trois façons d'ouvrir une couche au-dessus de la page.">
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>Dialogue</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archiver ce carnet ?</DialogTitle>
              <DialogDescription>Il reste lisible, mais plus personne ne pourra le modifier.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button>Archiver</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>Panneau</SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Détails du carnet</SheetTitle>
              <SheetDescription>Un panneau latéral pour un réglage ou un détail.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
        <Popover>
          <PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Dernière synchro</PopoverTitle>
              <PopoverDescription>Il y a deux minutes, depuis le téléphone.</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </Specimen>
      <Specimen id="tabs" title="Onglets" description="Le style par défaut et le style à filet.">
        <Tabs defaultValue="semaine" className="w-full">
          <TabsList>
            <TabsTrigger value="semaine">Semaine</TabsTrigger>
            <TabsTrigger value="mois">Mois</TabsTrigger>
          </TabsList>
          <TabsContent value="semaine">Cinq repas prévus.</TabsContent>
          <TabsContent value="mois">Vingt-deux repas prévus.</TabsContent>
        </Tabs>
        <Tabs defaultValue="a" className="w-full">
          <TabsList variant="line">
            <TabsTrigger value="a">Résumé</TabsTrigger>
            <TabsTrigger value="b">Détail</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Le résumé.</TabsContent>
          <TabsContent value="b">Le détail.</TabsContent>
        </Tabs>
      </Specimen>
      <Specimen id="toast" title="Toast" description="Un message bref qui s'efface seul.">
        <ToastDemo />
      </Specimen>
      <Specimen id="skeleton" title="Squelette" description="La place du contenu pendant qu'il arrive.">
        <div className="flex w-full flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Specimen>
    </Grid>
  </Page>;
}
