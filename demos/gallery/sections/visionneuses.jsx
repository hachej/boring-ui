import { Button } from '@/components/ui/button';
import { EmptyState } from '../../../registry/empty-state/blank-state.tsx';
import { Page, Specimen } from '../common.jsx';

export function Visionneuses() {
  return <Page id="visionneuses" title="Visionneuses" description="Les visionneuses de fichiers du kit (texte, image, tableau, canevas).">
    <Specimen id="viewers-soon" code={'npx boring-ui-blocks add <viewer>  (a later slice)'} feature={['gallery-viewers', 'features/gallery.md']} title="À venir" description="Emplacement réservé : les visionneuses arrivent dans une prochaine tranche de la démo." wide>
      <EmptyState className="w-full" title="Pas encore de visionneuse ici" hint="Chaque visionneuse sera montrée sur un fichier fictif, avec ses actions." action={<Button variant="outline" disabled>Bientôt</Button>} />
    </Specimen>
  </Page>;
}
