import { useScreenHeader } from '../../registry/app-shell/header.tsx';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useGallery } from './context.jsx';

// The page every section is made of: a title, one line saying what it shows (French), then cards in a grid. Kit parts and theme tokens only.

/** One section's page. `id` names its landmark (`data-testid="gallery-<id>"`). */
export function Page({ id, title, description, children }) {
  const { actions } = useGallery();
  useScreenHeader({ title: 'Galerie du kit', actions });
  return <section data-testid={`gallery-${id}`} aria-labelledby={`gallery-${id}-title`} className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
    <header className="flex flex-col gap-1">
      <h1 id={`gallery-${id}-title`} className="text-lg font-medium">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
    </header>
    {children}
  </section>;
}

/** The grid of cards: one column on a phone, two from `md`. */
export const Grid = ({ children }) => <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;

/** The usage line of a card: the import or registry name and the props that matter, with a copy button (clipboard where the browser allows it). */
function Usage({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* no clipboard on file:// in some browsers: the line stays selectable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return <div className="flex w-full items-center gap-2">
    <code data-testid="usage-code" className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono whitespace-nowrap select-all">{code}</code>
    <Button type="button" size="xs" variant="outline" onClick={copy} aria-label={`Copier : ${code}`}>{copied ? 'Copié' : 'Copier'}</Button>
  </div>;
}

/**
 * One card: what it shows, a line about it, the variants, then how to use it. `id` is its anchor (`#<id>`), `code` the copyable usage line,
 * `feature` the feature id in features/ and its file (plain text: the page is offline). `wide` takes both columns.
 */
export function Specimen({ id, title, description, wide = false, code, feature, children }) {
  return <Card size="sm" id={id} data-testid={id ? `specimen-${id}` : undefined} className={`scroll-mt-4${wide ? ' md:col-span-2' : ''}`}>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className="flex flex-wrap items-center gap-2">{children}</CardContent>
    {(code || feature) && <CardFooter className="flex-col items-start gap-2">
      {code && <Usage code={code} />}
      {feature && <p data-testid="feature-ref" className="text-muted-foreground">Fonctionnalité <code className="font-mono">{feature[0]}</code> · <code className="font-mono">{feature[1]}</code></p>}
    </CardFooter>}
  </Card>;
}
