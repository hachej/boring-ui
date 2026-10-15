// Canvas: the agent draws on one revisioned tldraw document that appears in the mounted editor without a reload; the person adds a shape
// with real pointer input and saves; a second agent request adds to the canvas keeping that shape. The viewer wraps the editor in the
// standard bar with Refresh and Share.
import assert from 'node:assert/strict';
import { DocumentRecordType, PageRecordType, TLDOCUMENT_ID, createShapeId, createTLSchema, toRichText } from '@tldraw/tlschema';
import { call } from './_script.mjs';

const EDITOR = `document.querySelector('[data-testid=workspace-panel] [data-boring=canvas-editor]')`;
const STAGE = `document.querySelector('[data-testid=workspace-panel] [data-boring=canvas-stage]')`;
const PANEL = `document.querySelector('[data-testid=workspace-panel] [data-testid=document]')`;
const shapeCount = `Number(${PANEL}?.dataset.shapes ?? 0)`;
const rendered = `document.querySelectorAll('[data-testid=workspace-panel] .tl-shape').length`;
const drawn = label => `(${STAGE}?.textContent ?? '').includes(${JSON.stringify(label)})`;
// A point in the empty band under the fitted diagram, shaped like an element for the driver's real-pointer click.
const EMPTY_SPOT = `(() => { const stage = ${STAGE}; return stage && { scrollIntoView() { stage.scrollIntoView({ block: 'center' }); },
  getBoundingClientRect() { const r = stage.getBoundingClientRect(); return { x: r.x + r.width * 0.5 - 1, y: r.y + r.height * 0.85 - 1, width: 2, height: 2 }; } }; })()`;

/** The saved canvas of the shown variant, read from its resource store. */
async function savedCanvas(t) {
  const variant = t.app.host.variants.get(t.variantId());
  const read = await variant.files.read({ target: variant.canvas, revision: { kind: 'latest' } }, t.app.host.agentAccess);
  return { read, variant };
}

export default [
  {
    id: 'canvas-draw', group: 'Canvas', requires: ['canvas'], title: 'Draw a diagram together',
    description: 'The agent draws three connected boxes; you add a rectangle and save; the agent adds a fourth keeping yours.',
    steps: [{ prompt: 'On the canvas, draw a small diagram of a fictional tea service: three labelled boxes "Boil", "Steep" and "Pour" in a row, connected left to right by two arrows.' }],
    script: {
      0: [
        call('read_canvas', {}),
        call('add_canvas_shapes', { shapes: [
          { id: 'boil', kind: 'rectangle', text: 'Boil', x: 0, y: 0 }, { id: 'steep', kind: 'rectangle', text: 'Steep', x: 280, y: 0 }, { id: 'pour', kind: 'rectangle', text: 'Pour', x: 560, y: 0 }],
          arrows: [{ from: 'boil', to: 'steep' }, { from: 'steep', to: 'pour' }] }),
        'The tea service is on the canvas.',
      ],
      // The person saved a rectangle since the agent last read the canvas: its first try, from memory, is refused; it reads again and the change lands.
      'add a fourth box labelled "Serve"': [
        call('add_canvas_shapes', { shapes: [{ id: 'serve', kind: 'rectangle', text: 'Serve', x: 840, y: 0 }], arrows: [{ from: 'pour', to: 'serve' }] }),
        call('read_canvas', {}),
        call('add_canvas_shapes', { shapes: [{ id: 'serve', kind: 'rectangle', text: 'Serve', x: 840, y: 0 }], arrows: [{ from: 'pour', to: 'serve' }] }),
        'Added Serve after Pour.',
      ],
    },
    expect: [{ toolCalled: 'add_canvas_shapes' }, { artifact: { type: 'canvas', count: 1 } }],
    async verify(t) {
      const { browser, q, button, idle } = t;
      const saved = async () => {
        const { read } = await savedCanvas(t);
        assert.equal(read.kind, 'available');
        const records = Object.values(JSON.parse(new TextDecoder().decode(read.snapshot.bytes)).store);
        return { revision: read.snapshot.ref.revision, shapes: records.filter(record => record.typeName === 'shape'), bindings: records.filter(record => record.typeName === 'binding') };
      };
      assert.deepEqual(t.app.agents().find(agent => agent.id === t.variantId()).tools.filter(name => /canvas/.test(name)), ['read_canvas', 'add_canvas_shapes', 'remove_canvas_shapes']);
      // The panel opened by itself when the agent saved: the diagram is in the mounted tldraw editor.
      await browser.until('diagram on the canvas', `${shapeCount} >= 5 && ${rendered} >= 5 && ['Boil', 'Steep', 'Pour'].every(label => ${STAGE}.textContent.includes(label))`, 120000);
      await t.panelControls('canvas');
      await browser.evaluate(`window.__canvasJourney = 'same-page'`);
      assert.equal(await browser.evaluate(`${EDITOR}.hasAttribute('data-dirty')`), false, 'showing the agent drawing must not dirty the canvas');
      const first = await saved();
      assert.equal(first.shapes.filter(shape => shape.type === 'geo').length, 3);
      assert.equal(first.shapes.filter(shape => shape.type === 'arrow').length, 2);
      assert.equal(first.bindings.length, 4);
      assert.equal(await browser.evaluate(`${PANEL}.dataset.revision`), first.revision);
      await browser.screenshot('canvas-agent.png');
      await t.shotMatrix('canvas');
      await browser.evaluate(`window.__canvasJourney = 'same-page'`); // the screenshots reload the page on a phone; the next edit must still need no reload
      await browser.until('the canvas is back', `${shapeCount} >= 5`, 30000);

      // The person draws a rectangle with the pointer and saves it.
      await browser.click(button('Rectangle'));
      await browser.until('rectangle tool', `${button('Rectangle')}?.getAttribute('aria-pressed') === 'true'`);
      await browser.click(EMPTY_SPOT);
      await browser.until('unsaved local edit', `${EDITOR}.hasAttribute('data-dirty') && ${shapeCount} === ${first.shapes.length + 1}`);
      assert.equal((await saved()).revision, first.revision, 'a local edit is not published before Save');
      await browser.click(button('Save'));
      await browser.until('saved', `${button('Save')}?.disabled === true && !${EDITOR}.hasAttribute('data-dirty')`);
      const after = await saved();
      assert.notEqual(after.revision, first.revision);
      const known = new Set(first.shapes.map(shape => shape.id));
      const added = after.shapes.filter(shape => !known.has(shape.id));
      assert.equal(added.length, 1);
      const human = added[0];
      assert.equal(human.type, 'geo');

      // A second agent request adds to the canvas and keeps the shape the person drew.
      await t.say('On the canvas, add a fourth box labelled "Serve" to the right of "Pour", with an arrow from Pour to Serve. Keep everything else as it is.');
      await browser.until('fourth box on the canvas', `${drawn('Serve')} && ${shapeCount} >= ${first.shapes.length + 3}`, 240000);
      await browser.until('idle', idle, 120000);
      const last = await saved();
      const kept = last.shapes.find(shape => shape.id === human.id);
      assert.deepEqual(kept, human, 'the person\'s rectangle is unchanged in the saved canvas');
      for (const shape of first.shapes) assert.ok(last.shapes.some(candidate => candidate.id === shape.id), `${shape.id} is still on the canvas`);
      assert.equal(last.shapes.filter(shape => shape.type === 'arrow').length, 3);
      // The stale try was refused, then the agent read again and its add landed on top of the person's save.
      const results = (await t.messages()).filter(message => message.role === 'toolResult' && message.toolName === 'add_canvas_shapes').map(message => message.content.map(part => part.text ?? '').join(''));
      assert.ok(results.some(text => /"kind":"conflict"/.test(text) && /changed since you last read it/.test(text)), `the agent's stale add was refused: ${JSON.stringify(results)}`);
      assert.equal(await browser.evaluate(`${PANEL}.dataset.revision`), last.revision);
      assert.equal(await browser.evaluate(`['Boil', 'Steep', 'Pour', 'Serve'].every(label => ${STAGE}.textContent.includes(label))`), true);
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=workspace-panel] .tl-shape[data-shape-id="' + ${JSON.stringify(human.id)} + '"]')`), true, 'the person\'s rectangle is still rendered');
      assert.equal(await browser.evaluate(`window.__canvasJourney`), 'same-page');
      await browser.screenshot('canvas.png');
      void q;
    },
  },
  {
    id: 'canvas-viewer', group: 'Canvas', requires: ['canvas'], title: 'The canvas in the standard viewer bar', panel: 'files', steps: [{ action: 'openPanel' }],
    description: 'The canvas document opens under the same bar as every viewer, with Refresh and Share, and follows a change made behind it.',
    async verify(t) {
      const { browser, q } = t;
      const { variant } = await savedCanvas(t);
      const schema = createTLSchema();
      const document = { schema: schema.serialize(), store: {} };
      const page = PageRecordType.create({ id: PageRecordType.createId('page'), name: 'Page 1', index: 'a1' });
      const put = (type, record) => { const valid = schema.types[type].validate(schema.types[type].create(record)); document.store[valid.id] = valid; };
      put('document', DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional board' })); put('page', page);
      const box = (name, x, text, color, order) => put('shape', { id: createShapeId(name), type: 'geo', parentId: page.id, index: `a${order}`, x, y: 40, props: { geo: 'rectangle', dash: 'solid', url: '', w: 160, h: 80, growY: 0, scale: 1,
        flipX: false, flipY: false, labelColor: 'black', color, fill: 'semi', size: 'm', font: 'sans', align: 'middle', verticalAlign: 'middle', richText: toRichText(text) } });
      box('one', 40, 'Moon', 'blue', 2);
      const target = variant.canvas;
      const publish = async current => {
        const bytes = new TextEncoder().encode(JSON.stringify(document));
        const result = await variant.files.publication.publish({ operationId: `canvas-viewer-${Math.random()}`, atomicity: 'all-or-nothing',
          changes: [current ? { kind: 'replace', target: { ...target, revision: current }, bytes, mediaType: 'application/vnd.tldraw+json' } : { kind: 'create', target, expected: { kind: 'absent' }, bytes, mediaType: 'application/vnd.tldraw+json' }] }, t.app.host.agentAccess);
        assert.equal(result.kind, 'committed');
        return result.receipt.changes[0].after.revision;
      };
      // Another scenario may have drawn already: replace whatever is saved.
      const { read: existing } = await savedCanvas(t);
      const revision = await publish(existing.kind === 'available' ? existing.snapshot.ref.revision : undefined);
      await t.tab('files');
      await browser.click(`[...document.querySelectorAll('.studio-panel li button')].find(b => b.textContent === 'board.tldraw')`);
      const scope = '[data-testid=canvas-viewer]';
      await browser.until('canvas in the frame', `${q(`${scope} [data-testid=viewer-bar]`)} !== null && Number(${q(`${scope} [data-testid=document]`)}?.dataset.shapes) === 1`, 30000);
      for (const id of ['more', 'share']) assert.equal(await browser.evaluate(`!!${q(`${scope} [data-testid=viewer-${id}]`)}`), true, `Canvas has ${id} (Reload is in the menu)`);
      assert.equal(await browser.evaluate(`!${q(`${scope} [data-testid=viewer-status]`)}`), true, 'a clean canvas shows no status');
      await browser.until('shape drawn', `document.querySelectorAll('[data-testid=workspace-panel] .tl-shape').length >= 1`);
      await t.shots('fileviewers-canvas');
      box('two', 260, 'Sun', 'orange', 3);
      await publish(revision);
      await t.menu(scope, 'viewer', 'refresh');
      await browser.until('refreshed canvas', `Number(${q(`${scope} [data-testid=document]`)}?.dataset.shapes) === 2`, 15000);
    },
  },
];
