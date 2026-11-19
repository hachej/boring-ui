import { createRoot } from 'react-dom/client';
import { AmbientWindow as AmbientChat } from '../../../registry/pi-ambient/ambient-window.tsx';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import { demoSlash } from '../../../ux/fixtures/demo-slash.jsx';
import script from '../../../ux/scenarios/scripts/design-system.json';

// The old ambient window (`AmbientWindow`, what `AmbientChat` renders for the props the one composer does not take; the composer's own bar is driven by test/contracts/ambient-composer.test.mjs)
// The ambient bar over a plain page, driven by the scripted assistant and the demo `/` menu: the tests drive it at 390 and 360 (the phone) and at 1440.
const { controller, actions, reset } = createDemoController({ script, pace: 0.15 });
const slash = demoSlash({ controller, reset });
createRoot(document.getElementById('root')).render(<div className="min-h-dvh bg-background p-4 text-sm text-foreground">
  <h1 className="m-0 text-lg font-semibold">A page</h1>
  <p className="text-muted-foreground">The ambient bar floats over this page.</p>
  <AmbientChat controller={controller} actions={actions} slash={slash} title="Assistant" />
</div>);
