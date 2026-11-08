// Browser side of the surface fixture (D-1899): a feedback session over a page whose main content is one image, the surface.
// `?pins=host` makes the host draw its own marks; `?pins=kit` (default) keeps the session's boxes. Fictional page only.
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { createFeedbackSession } from '@hachej/boring-feedback/ui';

const params = new URLSearchParams(location.search);
const points = [];
const session = createFeedbackSession({
  app: 'fictional-kiln', build: 'dev-fixture', root: document.getElementById('app'), policy: createPrivacyPolicy({}),
  surface: { element: document.getElementById('plate'), pins: params.get('pins') === 'host' ? 'host' : 'kit', onPoint: point => points.push(point) },
});
window.fixture = { session, points };
