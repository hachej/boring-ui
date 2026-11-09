import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '../../../registry/data-table/data-table.tsx';
import { EmptyState } from '../../../registry/empty-state/blank-state.tsx';
import { FilePick } from '../../../registry/file-pick/file-pick.tsx';
import { InlineQuestion } from '../../../registry/inline-question/inline-question.tsx';
import { KpiRow, KpiStat } from '../../../registry/kpi-stat/kpi-stat.tsx';
import { ListRow } from '../../../registry/list-row/list-row.tsx';
import { PageHeader } from '../../../registry/page-header/page-header.tsx';
import { SpaceCard } from '../../../registry/space-card/space-card.tsx';
import { StatusNarrative } from '../../../registry/status-narrative/status-narrative.tsx';
import { WiringChips } from '../../../registry/wiring-chips/wiring-chips.tsx';
import { PlusIcon } from '../../../registry/_shared/icons.ts';
import { Grid, Page, Specimen } from '../common.jsx';

const MEALS = [
  { id: 'lun', day: 'Lundi', dish: 'Soupe de légumes', status: 'Prévu', cost: '4,20 €' },
  { id: 'mar', day: 'Mardi', dish: 'Galettes de sarrasin', status: 'Prévu', cost: '6,80 €' },
  { id: 'mer', day: 'Mercredi', dish: 'Tarte aux poireaux', status: 'Cuisiné', cost: '5,10 €' },
  { id: 'jeu', day: 'Jeudi', dish: 'Riz aux pois chiches', status: 'Cuisiné', cost: '3,90 €' },
];
const COLUMNS = [
  { id: 'day', header: 'Jour', cell: row => row.day, priority: 1, width: '25%' },
  { id: 'dish', header: 'Plat', cell: row => row.dish, priority: 2 },
  { id: 'status', header: 'Statut', cell: row => <Badge variant={row.status === 'Cuisiné' ? 'success' : 'secondary'}>{row.status}</Badge>, priority: 2, width: '20%' },
  { id: 'cost', header: 'Coût', cell: row => row.cost, numeric: true, priority: 3, width: '18%' },
];

function InlineQuestions() {
  const [answers, setAnswers] = useState({});
  const answer = (id, value) => setAnswers(current => ({ ...current, [id]: value }));
  return <div className="flex w-full flex-col gap-4">
    <InlineQuestion id="q-day" kind="question" source="Assistant" text="Quel jour fait-on le marché cette semaine ?" options={[{ label: 'Samedi', recommended: true }, 'Dimanche']} answered={answers['q-day']} onAnswer={answer} />
    <InlineQuestion id="q-gate" kind="decision" tone="attention" source="Garde-fou" text="Supprimer le carnet de l'an dernier ?" answered={answers['q-gate'] === undefined ? undefined : answers['q-gate'] === 'approve' ? 'Approuvé' : 'Refusé'} onAnswer={answer} />
  </div>;
}

function FilePicks() {
  const [message, setMessage] = useState('Aucun fichier choisi.');
  const accepted = files => setMessage(`${files.length} fichier${files.length > 1 ? 's' : ''} : ${files.map(file => file.name).join(', ')}`);
  const refused = list => setMessage(`Refusé : ${list.map(({ file, reason }) => `${file.name} (${reason === 'type' ? 'type' : reason === 'size' ? 'taille' : 'nombre'})`).join(', ')}`);
  return <div className="flex w-full flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <FilePick accept="image/*,.pdf" multiple maxSize={2_000_000} onFiles={accepted} onRefused={refused} variant="outline">Choisir des fichiers</FilePick>
      <FilePick busy onFiles={accepted}>Envoi en cours</FilePick>
      <FilePick disabled onFiles={accepted}>Désactivé</FilePick>
    </div>
    <FilePick drop accept="image/*,.pdf" multiple maxSize={2_000_000} onFiles={accepted} onRefused={refused} hint="ou déposez des images et des PDF ici" variant="secondary">Ajouter un justificatif</FilePick>
    <p role="status" data-testid="file-pick-message" className="text-muted-foreground">{message}</p>
  </div>;
}

export function Blocs() {
  const [selected, setSelected] = useState('');
  return <Page id="blocs" title="Blocs d'app" description="Les blocs prêts à poser sur un écran : ils prennent des données et des callbacks, rien d'autre.">
    <Grid>
      <Specimen id="page-header" code={'npx boring-ui-blocks add page-header  ·  <PageHeader title badge actions assistant />'} feature={['pattern-page-header', 'features/patterns.md']} title="En-tête de page" description="Titre, badge, actions et l'ouverture de l'assistant." wide>
        <PageHeader className="w-full" title="Carnet de la semaine" badge="Brouillon" actions={<Button variant="outline">Partager</Button>} assistant={{ opensIn: 'panel', onOpen() {} }} />
      </Specimen>
      <Specimen id="kpi-stat" code={'npx boring-ui-blocks add kpi-stat  ·  <KpiStat label value compare />'} feature={['pattern-kpi-stat', 'features/patterns.md']} title="Chiffres clés" description="Un chiffre, son libellé et l'écart avec la lecture précédente." wide>
        <KpiRow className="w-full">
          <KpiStat label="Dépenses" value="86,40 €" compare={{ current: 86.4, previous: 72 }} />
          <KpiStat label="Repas cuisinés" value="14" compare={{ current: 14, previous: 18 }} />
          <KpiStat label="Restes" value="2" />
        </KpiRow>
      </Specimen>
      <Specimen id="list-row" code={'npx boring-ui-blocks add list-row  ·  <ListRow title subtitle trailing onSelect />'} feature={['pattern-list-row', 'features/patterns.md']} title="Ligne de liste" description="Pas de filet : le survol marque la ligne ; un bouton seulement si on peut la choisir.">
        <div className="flex w-full flex-col">
          {MEALS.map(meal => <ListRow key={meal.id} title={meal.dish} subtitle={meal.day} trailing={<span className="text-muted-foreground tabular-nums">{meal.cost}</span>} onSelect={() => setSelected(meal.id)} />)}
          <ListRow title="Total de la semaine" subtitle="Ligne simple, sans action" trailing={<span className="tabular-nums">20,00 €</span>} />
        </div>
        <p role="status" className="w-full text-muted-foreground">{selected ? `Ligne choisie : ${MEALS.find(meal => meal.id === selected)?.dish}` : 'Aucune ligne choisie.'}</p>
      </Specimen>
      <Specimen id="empty-state" code={'npx boring-ui-blocks add empty-state  ·  <EmptyState title hint action />'} feature={['pattern-empty-state', 'features/patterns.md']} title="État vide" description="Un titre, une phrase, une seule action.">
        <EmptyState className="w-full" title="Aucun repas prévu" hint="Ajoutez un premier plat pour commencer la semaine." action={<Button><PlusIcon data-icon="inline-start" />Ajouter un repas</Button>} />
      </Specimen>
      <Specimen id="data-table" code={'npx boring-ui-blocks add data-table  ·  <DataTable columns rows rowKey />'} feature={['pattern-data-table', 'features/patterns.md']} title="Tableau de données" description="Jamais de défilement latéral : en dessous de 520 px de large, chaque ligne s'empile." wide>
        <DataTable className="w-full" columns={COLUMNS} rows={MEALS} rowKey={row => row.id} caption="Repas de la semaine" />
      </Specimen>
      <Specimen id="space-card" code={'npx boring-ui-blocks add space-card  ·  <SpaceCard name activity lastShip onOpen />'} feature={['space-card', 'features/space-overview.md']} title="Carte d'espace" description="Un espace en un coup d'œil : en cours, en attente, calme ou illisible.">
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          <SpaceCard name="Cuisine" activity={{ working: 2, waiting: 1 }} lastShip={new Date(2026, 9, 27)} onOpen={() => {}} labels={{ working: 'en cours', waiting: 'vous attendent', lastShip: 'Dernière livraison' }} />
          <SpaceCard name="Jardin" activity={{ working: 0, waiting: 0 }} onOpen={() => {}} labels={{ quiet: 'Calme' }} />
          <SpaceCard name="Atelier" activity="unknown" onOpen={() => {}} labels={{ unknown: 'Statut illisible. Ce n\'est pas du calme.' }} />
        </div>
      </Specimen>
      <Specimen id="wiring-chips" code={'npx boring-ui-blocks add wiring-chips  ·  <WiringChips chips labels />'} feature={['wiring-chips', 'features/space-overview.md']} title="Raccordements" description="À quoi l'espace est relié, avec l'état de chaque lien.">
        <WiringChips className="w-full" chips={[{ label: 'Domaine cuisine.example', state: 'ok' }, { label: 'Agenda : connexion à refaire', state: 'warn' }, { label: 'Canal courses', state: 'unknown' }]} labels={{ ok: 'en ordre', warn: 'à revoir', unknown: 'illisible' }} />
      </Specimen>
      <Specimen id="file-pick" code={'npx boring-ui-blocks add file-pick  ·  <FilePick accept multiple maxSize onFiles onRefused />'} feature={['pattern-file-pick', 'features/patterns.md']} title="Choix de fichiers" description="Un bouton ou une zone de dépôt ; les refus reviennent avec leur motif." wide>
        <FilePicks />
      </Specimen>
      <Specimen id="inline-question" code={'npx boring-ui-blocks add inline-question  ·  <InlineQuestion kind="question|decision" options onAnswer />'} feature={['inline-question', 'features/attention.md']} title="Question en ligne" description="Une question qui attend, là où on en parle : choix rapides ou décision." wide>
        <InlineQuestions />
      </Specimen>
      <Specimen id="status-narrative" code={'npx boring-ui-blocks add status-narrative  ·  <StatusNarrative segments at by needsYou />'} feature={['status-narrative', 'features/attention.md']} title="Récit d'état" description="Deux ou trois phrases avec des liens, l'heure et l'auteur." wide>
        <StatusNarrative className="w-full" segments={['La semaine avance : ', { label: 'les courses', task: 'D-12' }, ' sont faites et ', { label: 'le menu de samedi', task: 'D-14' }, ' attend votre avis.']} at="il y a 2 min" by="routeur" needsYou={1}
          onOpen={() => {}} onRefresh={() => {}} labels={{ needsYou: count => (count === 1 ? '1 vous attend' : `${count} vous attendent`), refresh: 'Actualiser le récit' }} />
      </Specimen>
    </Grid>
  </Page>;
}
