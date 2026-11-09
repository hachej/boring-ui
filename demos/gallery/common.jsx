import { useScreenHeader } from '../../registry/app-shell/header.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

/** One card: what it shows, a line about it, then the variants. `wide` takes both columns. */
export function Specimen({ id, title, description, wide = false, children }) {
  return <Card size="sm" data-testid={id ? `specimen-${id}` : undefined} className={wide ? 'md:col-span-2' : undefined}>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className="flex flex-wrap items-center gap-2">{children}</CardContent>
  </Card>;
}
