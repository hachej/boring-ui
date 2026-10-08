// A fictional page for the "Run" mode of the HTML pane. Its inline script draws a small SVG solar system, sets document.title and reports to the
// parent with postMessage what the sandbox allows it to do (the journeys listen). It needs no network and no library.
export const INTERACTIVE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Orbit demo (static title)</title>
<style>
  html, body { margin: 0; height: 100%; }
  body { display: grid; place-items: center; align-content: center; gap: 12px; background: #0b1020; color: #e8ecff; font: 14px system-ui, sans-serif; }
  svg { width: min(70vmin, 320px); height: auto; }
  #status { margin: 0; opacity: .8; }
</style>
</head>
<body>
<h1 style="margin:0;font-size:18px">Fictional orbit</h1>
<svg id="sky" viewBox="0 0 240 240" role="img" aria-label="A planet circling a star"></svg>
<p id="status">starting</p>
<script>
  const ns = 'http://www.w3.org/2000/svg';
  const sky = document.getElementById('sky');
  const circle = (cx, cy, r, fill) => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r); c.setAttribute('fill', fill); sky.append(c); return c; };
  const ring = circle(120, 120, 80, 'none'); ring.setAttribute('stroke', '#3b4a86'); ring.setAttribute('stroke-dasharray', '3 5');
  circle(120, 120, 22, '#f5c542');
  const planet = circle(200, 120, 9, '#5ec2ff');
  let angle = 0;
  const spin = () => { angle += 0.02; planet.setAttribute('cx', 120 + 80 * Math.cos(angle)); planet.setAttribute('cy', 120 + 80 * Math.sin(angle)); requestAnimationFrame(spin); };
  spin();
  document.title = 'orbit-ran';
  document.getElementById('status').textContent = 'running';
  const report = { source: 'orbit-demo', ran: true, circles: sky.querySelectorAll('circle').length, title: document.title, origin: String(location.origin) };
  const attempt = async (name, run) => { try { report[name] = String(await run()); } catch (error) { report[name] = 'blocked:' + (error && error.name); } };
  (async () => {
    await attempt('fetch', () => fetch('https://example.com/ping').then(() => 'allowed'));
    await attempt('storage', () => localStorage.getItem('x') ?? 'allowed');
    await attempt('cookie', () => document.cookie === '' ? 'allowed' : 'allowed');
    await attempt('parent', () => parent.document.title);
    await attempt('script', () => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://example.com/lib.js'; s.onload = () => resolve('allowed'); s.onerror = () => reject(Object.assign(new Error('x'), { name: 'ScriptRefused' })); document.head.append(s); }));
    await attempt('popup', () => window.open('https://example.com/') ? 'allowed' : 'blocked:null');
    parent.postMessage(report, '*');
  })();
</script>
</body>
</html>
`;
