import { createRoot } from 'react-dom/client';
import { PeopleList } from '../../registry/sign-in/people.tsx';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { say } from '../../packages/ui/src/signin/words.ts';

// Component scenario `component:people`: the registry block's PeopleList mounted the way an app does it: in the kit's Sheet (a bottom sheet on a
// phone, a right one on a computer), its title and lead read by assistive technology only, no class on the list's wrapper but its padding, and
// `canInviteOwners` so the role picker shows. The Worker is fake (`window.fetch` answers in this page); its refusal is the kit's own sentence.
// Query: dark=1, pace (ignored), people=long (default: three people, one with a 40-character address) | empty (nobody invited) |
// error (the list loads, and inviting or removing is refused: owners only) | denied (the list itself is refused), lang=en.
const params = new URLSearchParams(location.search);
const lang = params.get('lang') === 'en' ? 'en' : 'fr';
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
document.documentElement.lang = lang;
const mode = params.get('people') ?? 'long';

let list = mode === 'empty' ? [] : [
  { email: 'beatrice.delacroix-harborfr@example.test', role: 'member', invitedBy: 'julie@example.test', at: '2026-01-09' },
  { email: 'julie@example.test', role: 'owner', invitedBy: 'julie@example.test', at: '2026-01-02' },
  { email: 'noe@example.test', role: 'member', invitedBy: 'julie@example.test', at: '2026-01-15' },
];
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.pathname !== '/api/signin/people') return reply({}, 404);
  const refused = () => reply({ code: 'OWNERS_ONLY', message: say('OWNERS_ONLY', lang) }, 403);
  const method = init.method ?? 'GET';
  if (method === 'GET') return mode === 'denied' ? refused() : reply({ people: list });
  if (mode === 'error') return refused();
  if (method === 'POST') { const { email, role } = JSON.parse(init.body); list = [...list, { email, role, invitedBy: 'julie@example.test', at: '2026-01-20' }]; return reply({}); }
  list = list.filter(p => p.email !== url.searchParams.get('email'));
  return reply({});
};

function App() {
  const phone = useIsMobile();
  return <main className="p-4 text-sm text-muted-foreground">
    <p className="m-0">Harbor Garage (fictional)</p>
    <Sheet open onOpenChange={() => {}}>
      <SheetContent side={phone ? 'bottom' : 'right'}>
        <SheetHeader className="sr-only">
          <SheetTitle>Personnes</SheetTitle>
          <SheetDescription>Seules les adresses de cette liste peuvent créer un compte.</SheetDescription>
        </SheetHeader>
        <div className="p-4 pt-6"><PeopleList locale={lang} canInviteOwners /></div>
      </SheetContent>
    </Sheet>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
