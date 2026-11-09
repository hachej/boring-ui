import { useMemo } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Page, Specimen } from '../common.jsx';
import { useGallery } from '../context.jsx';

/** This very page, rebuilt in a 390px iframe so the shell shows its phone layout (bottom tabs, one screen at a time). */
function PhoneFrame() {
  const { dark, compact } = useGallery();
  const srcDoc = useMemo(() => {
    const css = document.getElementById('gallery-css')?.textContent ?? '';
    const js = document.getElementById('gallery-js')?.textContent ?? '';
    const state = JSON.stringify({ dark, compact }).replaceAll('<', '\\u003c');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.__frame=${state};</script><script>${js}</script></body></html>`;
  }, [dark, compact]);
  return <div className="mx-auto w-[390px] max-w-full rounded-3xl border bg-muted p-2">
    <iframe title="Aperçu téléphone" data-testid="phone-frame" srcDoc={srcDoc} className="block h-[760px] w-full rounded-2xl bg-background" />
  </div>;
}

export function Coquille() {
  const framed = Boolean(window.__frame);
  return <Page id="coquille" title="Coquille" description="L'AppShell qui enveloppe cette page : barre latérale, en-tête, assistant, et sa version téléphone.">
    <Specimen id="shell" code={'npx boring-ui-blocks add app-shell  ·  <AppShell layout="screen" rail="hover" composer="content" nav route />'} feature={['shell-layouts', 'features/app-shell.md']} title="La coquille de cette page" description="Survolez la barre de gauche pour voir ses libellés ; l'assistant s'ouvre depuis l'en-tête, son champ reste en bas." wide>
      <Alert>
        <AlertTitle>Vous y êtes</AlertTitle>
        <AlertDescription>Cette page est une AppShell réelle : disposition « écran », barre au survol, champ de l'assistant sous le contenu. Le commutateur d'en-tête change le thème et la densité.</AlertDescription>
      </Alert>
    </Specimen>
    <Specimen id="phone" code={'<AppShell compactNav="tabs|sheet" />  (below 768px)'} feature={['shell-nav', 'features/app-shell.md']} title="Téléphone" description="La même coquille dans un cadre de 390 px : onglets en bas, un écran à la fois." wide>
      {framed
        ? <Alert data-testid="phone-nested-note"><AlertTitle>Aperçu déjà en cours</AlertTitle><AlertDescription>Vous êtes dans le cadre téléphone ; l'aperçu ne s'imbrique pas.</AlertDescription></Alert>
        : <PhoneFrame />}
    </Specimen>
  </Page>;
}
