// The document of the sandboxed frame in which the official diagrams.net viewer draws a draw.io file (D-1398). The frame is an opaque
// origin (`sandbox="allow-scripts"` only, so it shares nothing with this page) and its Content-Security-Policy allows no network at all and only the
// scripts carrying this frame's nonce: the boot script below and the viewer it inserts. A label's HTML is sanitised by draw.io and, even if
// it carried a handler or a script, the policy refuses it; `mxUtils.eval` (function bodies in a file) fails, since the policy allows no eval.
// The boot script waits for one message from the parent with a port, the viewer's text and the file; it answers once on that port with
// the SVG draw.io exports (`Graph.getSvg`, white page) and what the viewer's own model read, or with an error.

/** The policy of the frame: no fetch, frame, image or font from anywhere but inline data, and only nonce scripts. */
export const drawioPolicy = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;

/** Runs in the frame (ES5, before and after the viewer): reads the model the viewer decoded and exports its SVG. */
const BOOT = String.raw`(function () {
  var nonce = document.currentScript && document.currentScript.nonce, port = null;
  try { window.localStorage; } catch (error) {
    var memory = function () { var items = {}; return { getItem: function (key) { return Object.prototype.hasOwnProperty.call(items, key) ? items[key] : null; },
      setItem: function (key, value) { items[key] = String(value); }, removeItem: function (key) { delete items[key]; }, clear: function () { items = {}; },
      key: function (index) { return Object.keys(items)[index] || null; }, get length() { return Object.keys(items).length; } }; };
    try { Object.defineProperty(window, 'localStorage', { configurable: true, value: memory() }); Object.defineProperty(window, 'sessionStorage', { configurable: true, value: memory() }); } catch (ignored) {}
  }
  window.mxLoadResources = false; window.mxLoadStylesheets = false; window.mxForceIncludes = false;
  function answer(message) { if (port) { port.postMessage(message); port.close(); port = null; } }
  function fail(reason, error) { answer({ type: 'error', reason: reason, message: String(error && error.message || error || reason) }); }
  function plain(value, html) {
    var text = value == null ? '' : String(value);
    if (html) {
      var parsed = new DOMParser().parseFromString(text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h[1-6])>/gi, '\n</$1>'), 'text/html');
      var hidden = parsed.querySelectorAll('script, style, template');
      for (var h = 0; h < hidden.length; h++) hidden[h].remove();
      text = parsed.body ? parsed.body.textContent || '' : '';
    }
    return text.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  function colour(value) { return value && value !== 'none' ? String(value) : undefined; }
  function read(graph) {
    var model = graph.getModel(), view = graph.view, scale = view.scale, dx = view.translate.x, dy = view.translate.y, shapes = [], arrows = [], labels = {};
    var place = function (state) { return { x: state.x / scale - dx, y: state.y / scale - dy, width: state.width / scale, height: state.height / scale }; };
    var label = function (cell) { return plain(graph.convertValueToString(cell), graph.isHtmlLabel(cell)) || undefined; };
    for (var id in model.cells) {
      var cell = model.cells[id], state = view.getState(cell), parent = model.getParent(cell);
      if (!state || !(model.isVertex(cell) || model.isEdge(cell))) continue;
      if (model.isVertex(cell) && model.isEdge(parent)) { var text = label(cell); if (text) labels[parent.id] = labels[parent.id] ? labels[parent.id] + '\n' + text : text; continue; }
      var style = state.style || {};
      if (model.isEdge(cell)) {
        var source = model.getTerminal(cell, true), target = model.getTerminal(cell, false), points = [];
        for (var i = 0; i < (state.absolutePoints || []).length; i++) { var point = state.absolutePoints[i]; if (point) points.push([point.x / scale - dx, point.y / scale - dy]); }
        var arrowhead = style.endArrow !== 'none' || (style.startArrow && style.startArrow !== 'none');
        arrows.push({ id: String(cell.id), kind: arrowhead ? 'arrow' : 'line', from: source ? String(source.id) : undefined, to: target ? String(target.id) : undefined, points: points, label: label(cell), stroke: colour(style.strokeColor) });
      } else {
        var box = place(state);
        shapes.push({ id: String(cell.id), kind: String(style.shape || 'rectangle'), x: box.x, y: box.y, width: box.width, height: box.height, label: label(cell),
          stroke: colour(style.strokeColor), fill: colour(style.fillColor), parent: model.isVertex(parent) ? String(parent.id) : undefined });
      }
    }
    for (var a = 0; a < arrows.length; a++) if (labels[arrows[a].id]) arrows[a].label = arrows[a].label ? arrows[a].label + '\n' + labels[arrows[a].id] : labels[arrows[a].id];
    var bounds = graph.getGraphBounds();
    return { format: 'drawio', bounds: { x: bounds.x / scale - dx, y: bounds.y / scale - dy, width: bounds.width / scale, height: bounds.height / scale }, shapes: shapes, arrows: arrows };
  }
  function draw(xml) {
    var document_ = mxUtils.parseXml(xml), root = document_ && document_.documentElement;
    if (!root || ['mxfile', 'mxGraphModel', 'diagram'].indexOf(root.nodeName) < 0) return fail('unreadable', 'not a draw.io file');
    var node;
    try { node = Editor.extractGraphModel(root); } catch (error) { return fail('unreadable', error); }
    if (!node) return fail('unreadable', 'no diagram in the file');
    var graph = new Graph(document.getElementById('graph'));
    graph.setEnabled(false);
    try { new mxCodec(node.ownerDocument).decode(node, graph.getModel()); } catch (error) { return fail('unreadable', error); }
    var drawing = read(graph);
    if (!drawing.shapes.length && !drawing.arrows.length) return fail('empty', 'the diagram draws nothing');
    var svg = graph.getSvg('#ffffff', 1, 16, false, null, true);
    var width = parseFloat(svg.getAttribute('width')) || drawing.bounds.width + 32, height = parseFloat(svg.getAttribute('height')) || drawing.bounds.height + 32;
    answer({ type: 'drawn', svg: mxUtils.getXml(svg), width: width, height: height, drawing: drawing });
  }
  window.addEventListener('message', function (event) {
    if (port || event.source !== window.parent || !event.ports || !event.ports[0] || !event.data || event.data.type !== 'draw') return;
    port = event.ports[0];
    try {
      var viewer = document.createElement('script');
      viewer.nonce = nonce; viewer.textContent = String(event.data.viewer);
      document.head.appendChild(viewer);
      if (typeof Graph === 'undefined' || typeof Editor === 'undefined') return fail('renderer', 'the draw.io viewer did not load');
    } catch (error) { return fail('renderer', error); }
    try { draw(String(event.data.xml)); } catch (error) { fail('renderer', error); }
  });
})();`;

/** The frame's whole document for `nonce` (fresh per drawing). */
export function drawioFrameDocument(nonce: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${drawioPolicy(nonce)}">`
    + `<style>html,body{margin:0;background:#fff}#graph{position:absolute;left:0;top:0;width:2000px;height:2000px;overflow:hidden}</style>`
    + `<script nonce="${nonce}">${BOOT}</script></head><body><div id="graph"></div></body></html>`;
}
