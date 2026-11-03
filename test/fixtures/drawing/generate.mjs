// Writes the drawing viewer's fictional fixtures (D-1398): `node test/fixtures/drawing/generate.mjs`. An Excalidraw garden plan with every
// element kind (rectangle, ellipse, diamond, arrow bound to two shapes with its own label, line, text, freehand, containers' labels, a
// deleted element and a script-shaped text with a javascript: link) and a draw.io bakery morning (a container, a group, a cylinder,
// edges with bend points and labels, an edge label child, a plain line, an image from the network the viewer must refuse, an HTML label
// carrying a script and a handler), compressed and plain. The garden also has a line turned a quarter.
import { writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('.', import.meta.url));
let seed = 1000;
const base = (o) => ({ angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
  groupIds: [], frameId: null, roundness: null, seed: seed++, version: 1, versionNonce: seed++, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false, ...o });
const text = (o) => base({ type: 'text', fontSize: 20, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', lineHeight: 1.25, autoResize: true, ...o, originalText: o.text });
const elements = [
  base({ id: 'beds', type: 'rectangle', x: 40, y: 60, width: 220, height: 110, backgroundColor: '#b2f2bb', roundness: { type: 3 }, boundElements: [{ type: 'text', id: 'beds-label' }, { type: 'arrow', id: 'water-path' }] }),
  text({ id: 'beds-label', x: 70, y: 102, width: 160, height: 25, text: 'Vegetable beds', containerId: 'beds' }),
  base({ id: 'pond', type: 'ellipse', x: 420, y: 50, width: 180, height: 130, backgroundColor: '#a5d8ff', strokeColor: '#1971c2', boundElements: [{ type: 'text', id: 'pond-label' }, { type: 'arrow', id: 'water-path' }] }),
  text({ id: 'pond-label', x: 470, y: 102, width: 80, height: 25, text: 'Rain pond', containerId: 'pond', strokeColor: '#1971c2' }),
  base({ id: 'gate', type: 'diamond', x: 220, y: 280, width: 160, height: 120, backgroundColor: '#ffec99', strokeColor: '#e8590c', fillStyle: 'hachure', boundElements: [{ type: 'text', id: 'gate-label' }] }),
  text({ id: 'gate-label', x: 260, y: 327, width: 80, height: 25, text: 'Gate?', containerId: 'gate', strokeColor: '#e8590c' }),
  base({ id: 'water-path', type: 'arrow', x: 418, y: 115, width: 156, height: 20, points: [[0, 0], [-80, 20], [-156, 0]], strokeColor: '#1971c2', roundness: { type: 2 },
    startBinding: { elementId: 'pond', focus: 0, gap: 2 }, endBinding: { elementId: 'beds', focus: 0, gap: 2 }, startArrowhead: null, endArrowhead: 'arrow', boundElements: [{ type: 'text', id: 'water-label' }] }),
  text({ id: 'water-label', x: 300, y: 122, width: 80, height: 20, text: 'Watering', containerId: 'water-path', fontSize: 16, strokeColor: '#1971c2' }),
  base({ id: 'fence', type: 'line', x: 40, y: 450, width: 560, height: 30, points: [[0, 0], [280, 30], [560, 0]], strokeColor: '#868e96', strokeStyle: 'dashed' }),
  text({ id: 'note', x: 430, y: 300, width: 190, height: 50, text: 'Plan for the fictional\nOakfield garden', textAlign: 'left', verticalAlign: 'top', fontSize: 18 }),
  base({ id: 'path-scribble', type: 'freedraw', x: 60, y: 300, width: 120, height: 60, points: [[0, 0], [20, 15], [40, 40], [60, 50], [80, 45], [100, 30], [120, 60]], pressures: [], simulatePressure: true, strokeColor: '#2f9e44' }),
  base({ id: 'tilted', type: 'line', x: 650, y: 100, width: 100, height: 0, angle: Math.PI / 2, points: [[0, 0], [100, 0]], strokeColor: '#868e96' }),
  base({ id: 'old-shed', type: 'rectangle', x: 700, y: 600, width: 80, height: 80, isDeleted: true, backgroundColor: '#ff8787' }),
  text({ id: 'unsafe', x: 40, y: 500, width: 420, height: 18, text: '<script>parent.postMessage("pwned","*")</script> stays text', fontSize: 14, textAlign: 'left', verticalAlign: 'top', link: 'javascript:parent.postMessage("pwned","*")' }),
];
writeFileSync(`${out}oakfield-garden.excalidraw`, `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://fictional.invalid', elements, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} }, null, 2)}\n`);

const model = [
  '<mxGraphModel dx="1000" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>',
  '<mxCell id="kitchen" value="Kitchen" style="swimlane;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;startSize=30;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="300" height="260" as="geometry"/></mxCell>',
  '<mxCell id="dough" value="&lt;b&gt;Mix&lt;/b&gt; dough" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="kitchen"><mxGeometry x="30" y="50" width="120" height="60" as="geometry"/></mxCell>',
  '<mxCell id="oven" value="Bake" style="ellipse;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;" vertex="1" parent="kitchen"><mxGeometry x="140" y="170" width="120" height="70" as="geometry"/></mxCell>',
  '<mxCell id="check" value="Golden?" style="rhombus;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="440" y="190" width="120" height="100" as="geometry"/></mxCell>',
  '<mxCell id="shelf-group" value="" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="420" y="390" width="260" height="70" as="geometry"/></mxCell>',
  '<mxCell id="shelf" value="Shop shelf" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=10;fillColor=#e1d5e7;strokeColor=#9673a6;" vertex="1" parent="shelf-group"><mxGeometry width="120" height="70" as="geometry"/></mxCell>',
  '<mxCell id="sign" value="Fresh &amp;amp; warm&lt;img src=x onerror=&quot;parent.postMessage(\'pwned\',\'*\')&quot;&gt;&lt;script&gt;parent.postMessage(\'pwned\',\'*\')&lt;/script&gt;" style="text;html=1;align=center;verticalAlign=middle;sketch=1;" vertex="1" parent="shelf-group"><mxGeometry x="140" y="20" width="120" height="30" as="geometry"/></mxCell>',
  '<mxCell id="logo" value="" style="shape=image;image=https://fictional.invalid/logo.png;imageAspect=0;" vertex="1" parent="1"><mxGeometry x="620" y="200" width="60" height="60" as="geometry"/></mxCell>',
  '<mxCell id="to-oven" value="rest 1 h" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=classic;strokeColor=#d6b656;" edge="1" parent="kitchen" source="dough" target="oven"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="90" y="205"/></Array></mxGeometry></mxCell>',
  '<mxCell id="to-check" value="" style="html=1;endArrow=classic;strokeColor=#b85450;" edge="1" parent="1" source="oven" target="check"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="400" y="245"/><mxPoint x="400" y="240"/></Array></mxGeometry></mxCell>',
  '<mxCell id="to-check-label" value="25 min" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];" vertex="1" connectable="0" parent="to-check"><mxGeometry x="-0.2" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>',
  '<mxCell id="to-shelf" value="yes" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=block;strokeColor=#82b366;" edge="1" parent="1" source="check" target="shelf"><mxGeometry relative="1" as="geometry"/></mxCell>',
  '<mxCell id="again" value="no" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=classic;dashed=1;strokeColor=#82b366;" edge="1" parent="1" source="check" target="oven"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="500" y="340"/><mxPoint x="240" y="340"/></Array></mxGeometry></mxCell>',
  '<mxCell id="to-logo" value="" style="html=1;endArrow=none;startArrow=none;strokeColor=#666666;" edge="1" parent="1" source="check" target="logo"><mxGeometry relative="1" as="geometry"/></mxCell>',
  '</root></mxGraphModel>',
].join('');
const file = (diagram) => `<mxfile host="fictional.invalid" agent="fixture" version="32.4.1">\n  <diagram id="bakery" name="Bakery morning">${diagram}</diagram>\n</mxfile>\n`;
writeFileSync(`${out}bakery-morning.drawio`, file(deflateRawSync(Buffer.from(encodeURIComponent(model), 'utf8')).toString('base64')));
writeFileSync(`${out}bakery-morning-plain.drawio`, file(model));
writeFileSync(`${out}broken.excalidraw`, '{ "type": "excalidraw", "elements": [ \n');
