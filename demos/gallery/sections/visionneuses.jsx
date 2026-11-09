import { useMemo, useState } from 'react';
import { ArtifactViewer } from '@hachej/boring-ui-kit/artifact-viewer';
import { CsvView } from '../../../registry/viewer-code/csv-table.tsx';
import { SvgView } from '../../../registry/viewer-code/svg-view.tsx';
import { ImagePane } from '../../../registry/viewer-image/image-pane.tsx';
import { Grid, Page, Specimen } from '../common.jsx';

// Fictional files only. Each viewer is the kit's own, drawn over a file made here.
const MARKET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#f4efe6"/><rect x="24" y="110" width="272" height="66" rx="6" fill="#d9a441"/><circle cx="80" cy="70" r="26" fill="#6b9a5b"/><circle cx="160" cy="60" r="20" fill="#c8553d"/><circle cx="236" cy="72" r="24" fill="#6b9a5b"/><text x="160" y="150" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#3b2f1c">Étal du marché</text></svg>`;
const MENU_CSV = 'Jour,Plat,Coût\nLundi,Soupe de légumes,"4,20 €"\nMardi,Galettes de sarrasin,"6,80 €"\nMercredi,Tarte aux poireaux,"5,10 €"\n';
const NOTES_MD = '# Notes de la semaine\n\nLe marché est le **samedi**. À prévoir :\n\n- des poireaux pour la tarte\n- du sarrasin pour les galettes\n\n> Fichier fictif : aucune donnée réelle.\n';
const SHOPPING_TXT = 'Courses du samedi\n- poireaux\n- sarrasin\n- pois chiches\n';

const Frame = ({ testId, children }) => <div data-testid={testId} className="h-72 w-full overflow-auto rounded-lg border bg-background">{children}</div>;

function ImageViewer() {
  const bytes = useMemo(() => new TextEncoder().encode(MARKET_SVG), []);
  return <Frame testId="viewer-image-frame"><ImagePane name="etal-du-marche.svg" mediaType="image/svg+xml" bytes={bytes} subtitle="Fichier fictif" testId="gallery-image" /></Frame>;
}

function SvgViewer() {
  const [controls, setControls] = useState();
  return <Frame testId="viewer-svg-frame">
    <div className="flex items-center gap-2 border-b p-2" data-testid="viewer-svg-bar">{controls}</div>
    <div className="h-60"><SvgView text={MARKET_SVG} artifact={{ title: 'etal-du-marche.svg' }} setControls={setControls} /></div>
  </Frame>;
}

export function Visionneuses() {
  return <Page id="visionneuses" title="Visionneuses" description="Les visionneuses de fichiers du kit, chacune sur un fichier fictif.">
    <Grid>
      <Specimen id="viewer-image" code={"import { ImagePane } from '@/components/viewer-image/image-pane'  ·  npx boring-ui-blocks add viewer-image"} feature={['gallery-viewers', 'features/gallery.md']} title="Image" description="Zoom, ajuster, taille réelle, sur un dessin fictif.">
        <ImageViewer />
      </Specimen>
      <Specimen id="viewer-svg" code={"import { SvgView } from '@/components/viewer-code/svg-view'  ·  npx boring-ui-blocks add viewer-code"} feature={['gallery-viewers', 'features/gallery.md']} title="SVG" description="Aperçu ou source, à la demande.">
        <SvgViewer />
      </Specimen>
      <Specimen id="viewer-csv" code={"import { CsvView } from '@/components/viewer-code/csv-table'  ·  npx boring-ui-blocks add viewer-code"} feature={['gallery-viewers', 'features/gallery.md']} title="Tableau CSV" description="Un fichier CSV lu comme un tableau.">
        <Frame testId="viewer-csv-frame"><CsvView text={MENU_CSV} artifact={{ title: 'menu.csv' }} /></Frame>
      </Specimen>
      <Specimen id="viewer-markdown" code={"import { ArtifactViewer } from '@hachej/boring-ui-kit/artifact-viewer'"} feature={['gallery-viewers', 'features/gallery.md']} title="Markdown" description="Un document Markdown rendu dans un cadre isolé.">
        <Frame testId="viewer-markdown-frame"><ArtifactViewer name="notes.md" mimeType="text/markdown" content={NOTES_MD} className="h-full [&_iframe]:h-full [&_iframe]:w-full" /></Frame>
      </Specimen>
      <Specimen id="viewer-text" code={"import { ArtifactViewer } from '@hachej/boring-ui-kit/artifact-viewer'"} feature={['gallery-viewers', 'features/gallery.md']} title="Texte" description="Un fichier texte tel quel." wide>
        <Frame testId="viewer-text-frame"><ArtifactViewer name="courses.txt" mimeType="text/plain" content={SHOPPING_TXT} className="p-3 font-mono" /></Frame>
      </Specimen>
    </Grid>
  </Page>;
}
