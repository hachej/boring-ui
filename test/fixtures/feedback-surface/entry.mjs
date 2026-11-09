// Browser side of the surface fixture (D-1899): a feedback session over a page whose main content is one image, the surface.
// `?pins=host` makes the host draw its own marks; `?pins=kit` (default) keeps the session's boxes. `?mirror=1` mirrors the image
// (CSS scaleX(-1)). `?bubble=1` mounts the registry's NoteBubble. Fictional page only.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createPrivacyPolicy } from '@hachej/boring-feedback/page';
import { createFeedbackSession, parseSaveRequest } from '@hachej/boring-feedback/ui';
import { parseFeedback } from '@hachej/boring-feedback/format';
import { NoteBubble } from '../../../registry/feedback/feedback-session.tsx';

const params = new URLSearchParams(location.search);
const plate = document.getElementById('plate');
if (params.get('mirror') === '1') plate.style.transform = 'scaleX(-1)';
if (params.get('scale') === '1') plate.style.scale = '-1 1';
if (params.get('rotate') === '1') plate.style.rotate = '90deg';
if (params.get('ancestor') === '1') plate.parentElement.style.transform = 'scaleX(-1)';
// `?size=640x420` and `?at=100,120` size and place the surface; `?dark=1` turns the host's dark tokens on (D-1967).
if (params.get('size')) { const [w, h] = params.get('size').split('x'); plate.style.width = `${w}px`; plate.style.height = `${h}px`; }
if (params.get('at')) { const [x, y] = params.get('at').split(','); plate.style.left = `${x}px`; plate.style.top = `${y}px`; }
if (params.get('dark') === '1') document.documentElement.classList.add('dark');
const points = [];
const saved = [];
const session = createFeedbackSession({
  app: 'fictional-kiln', build: 'dev-fixture', root: document.getElementById('app'), policy: createPrivacyPolicy({}),
  surface: { element: plate, pins: params.get('pins') === 'host' ? 'host' : 'kit', onPoint: point => points.push(point) },
  save: async request => { saved.push(request); return { kind: 'saved', id: 'fb_7Q2mK9xRt4vW1cZp', revision: 'r1' }; },
});
if (params.get('bubble') === '1') createRoot(document.getElementById('ui')).render(createElement(NoteBubble, { session }));
// What a host route and a reader do with a sent report: the save route's request check (`store.create` validates with the same
// draft check), and the stored report text parsed back strictly.
const checkSent = () => {
  const request = parseSaveRequest(JSON.parse(JSON.stringify(saved[0])));
  const text = session.reportText();
  const parsed = parseFeedback(new TextEncoder().encode(text));
  return { accepted: request.ok, reason: request.ok ? '' : request.reason, text, parsed: parsed.ok, notes: parsed.ok ? parsed.report.notes : parsed.problems };
};
window.fixture = { session, points, saved, checkSent };
