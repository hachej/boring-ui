import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button as LegacyButton } from './legacy-button.tsx';
import { BlockActions } from '../../../registry/button/actions.tsx';

// D-1770: small controls in a page with NO scope class (no .pi-chat, .app-shell or .boring-viewer), and in a Popover portaled at body. `legacy-*` is a Button
// copy from before D-1741 (no floor of its own, like an app's pinned copy); `kit-*` is the current kit Button; Toggle and ToggleGroupItem have no floor either.
// Fictional text only.
const Dot = props => <svg {...props} viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" /></svg>;
const noop = () => {};
function Controls({ where }) {
  const id = name => `${where}-${name}`;
  return <div className="flex flex-wrap items-center gap-2">
    <LegacyButton size="sm" variant="outline" data-testid={id('legacy-sm')}>Try again</LegacyButton>
    <LegacyButton size="icon-sm" variant="outline" aria-label="Copy" data-testid={id('legacy-icon-sm')}><Dot /></LegacyButton>
    <LegacyButton size="xs" variant="outline" data-testid={id('legacy-xs')}>Save</LegacyButton>
    <Button size="sm" variant="outline" data-testid={id('kit-sm')}>My apps</Button>
    <Button size="icon-sm" variant="outline" aria-label="Remove" data-testid={id('kit-icon-sm')}><Dot /></Button>
    <Button variant="link" data-size="inline" data-testid={id('inline')} className="h-auto min-h-0 min-w-0 max-md:min-h-0 max-md:min-w-0 pointer-coarse:min-h-0 pointer-coarse:min-w-0 p-0">Docs</Button>
    <Toggle size="sm" variant="outline" aria-label="Pin" data-testid={id('toggle-sm')}><Dot /></Toggle>
    <ToggleGroup variant="outline" size="sm" defaultValue={['a']}><ToggleGroupItem value="a" aria-label="Day" data-testid={id('group-item')}><Dot /></ToggleGroupItem><ToggleGroupItem value="b" aria-label="Week"><Dot /></ToggleGroupItem></ToggleGroup>
  </div>;
}
const actions = [{ id: 'pin', label: 'Pin', icon: Dot, pressed: true, onSelect: noop }, { id: 'share', label: 'Share', icon: Dot, onSelect: noop }, { id: 'rename', label: 'Rename', onSelect: noop }];
// ?only=dense: the kit's own scope-less action row (BlockActions: a pressed Toggle, an icon Button, a text Button).
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('only') === 'dense' ? <main className="p-4"><div data-case="dense" className="flex items-center gap-1 rounded-md border p-1"><BlockActions actions={actions} testId="dense" menuLabel="More" /></div></main> : <main className="flex flex-col gap-3 p-4">
  <div data-case="plain"><Controls where="plain" /></div>
  <div data-case="compact" data-density="compact"><Controls where="compact" /></div>
  <Popover defaultOpen><PopoverTrigger render={<Button variant="outline" data-testid="popover-trigger" />}>Filters</PopoverTrigger>
    <PopoverContent side="bottom" align="start" data-testid="popover-content" className="w-80"><Controls where="popover" /></PopoverContent></Popover>
</main>);
