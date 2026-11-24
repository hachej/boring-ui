import { createRoot } from 'react-dom/client';
import { FloatingComposer } from '../../../registry/app-shell/floating-composer.tsx';
import { createDemoController } from '../../../ux/fixtures/demo-controller.mjs';
import { demoSlash } from '../../../ux/fixtures/demo-slash.jsx';
import script from '../../../ux/scenarios/scripts/design-system.json';

// The floating composer over a plain page, driven by the scripted assistant and the demo `/` menu: the tests drive it at 390 and 360 (the phone) and at 1440.
// The composer's own levels and options are driven by test/contracts/floating-composer-levels.test.mjs and floating-composer-options.test.mjs.
const { controller, actions, reset } = createDemoController({ script, pace: 0.15 });
const slash = demoSlash({ controller, reset });
createRoot(document.getElementById('root')).render(<div className="min-h-dvh bg-background p-4 text-sm text-foreground">
  <h1 className="m-0 text-lg font-semibold">A page</h1>
  <p className="text-muted-foreground">The floating bar sits over this page.</p>
  <FloatingComposer agent={{ controller, label: 'Assistant', chatProps: { actions, slash } }} appId="page" />
</div>);
