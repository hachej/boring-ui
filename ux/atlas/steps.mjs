// The atlas's one step runner. A step is a person's action on the real controls: a click on a control's test id, a key, a drag of the grip, a word the agent receives,
// a host notice, a resize of the window. The Atlas page runs them in its live thumbnails and `test/contracts/atlas.impl.mjs` runs the very same steps in happy-dom,
// so what the page shows and what the test proves cannot disagree. `env`: { root, win, act, hooks }; `act` wraps each step (React's act in a test, a plain call in a page).

/** A test id (`agent-tray-grow`) or a selector (anything that is not a plain id). */
export const selector = id => /^[\w-]+$/.test(id) ? `[data-testid=${id}]` : id;

const wait = ms => new Promise(done => setTimeout(done, ms));

/** The element for a step: polled for up to 3 s, because the control may mount a frame after the step before it. */
async function find(env, id) {
  for (let tries = 0; tries < 120; tries++) {
    const found = env.root.querySelector(selector(id));
    if (found) return found;
    await env.act(() => wait(25));
  }
  throw new Error(`atlas step: no element ${selector(id)}`);
}

const parseKey = combo => {
  const parts = combo.split('+'), key = parts.pop();
  return { key, ctrlKey: parts.includes('Control'), metaKey: parts.includes('Meta'), shiftKey: parts.includes('Shift') };
};

/** Runs one step. */
export async function runStep(env, step) {
  const { win } = env;
  if (step.click) {
    const element = await find(env, step.click);
    await env.act(() => { element.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); });
  } else if (step.tap) {
    // A press and a release in place on an element's centre (the phone's grabber reads pointer events, not clicks).
    const element = await find(env, step.tap);
    const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const at = type => element.dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
    await env.act(() => { at('pointerdown'); });
    await env.act(() => { at('pointerup'); });
  } else if (step.key) {
    const target = step.on ? await find(env, step.on) : win.document;
    await env.act(() => { target.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...parseKey(step.key) })); });
  } else if (step.drag) {
    const grip = await find(env, step.drag.grip ?? 'composer-grip');
    const [x0, y0] = step.drag.from, [x1, y1] = step.drag.to;
    const at = (type, x, y) => grip.dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0 }));
    await env.act(() => { at('pointerdown', x0, y0); });
    await env.act(() => { at('pointermove', x1, y1); });
    await env.act(() => { at('pointerup', x1, y1); });
  } else if (step.wait) {
    await env.act(() => wait(step.wait));
  } else if (step.say !== undefined) {
    await env.act(() => env.hooks.say(step.say));
    await env.act(() => wait(step.settle ?? 120));
  } else if (step.notify) {
    await env.act(() => env.hooks.notify(step.notify));
  } else if (step.connection) {
    await env.act(() => env.hooks.connection(step.connection));
  } else if (step.resize) {
    await env.act(() => env.hooks.resize(step.resize));
  } else throw new Error(`atlas step: unknown ${JSON.stringify(step)}`);
  await env.act(() => wait(40));
}

export async function runSteps(env, steps = []) { for (const step of steps) await runStep(env, step); }

/** Whether a state's marker is on the page now: every `has` selector matches and no `lacks` selector does. */
export function isIn(root, detect) {
  const present = id => [...root.querySelectorAll(selector(id))].some(element => !element.closest('[hidden]'));
  return (detect.has ?? []).every(present) && !(detect.lacks ?? []).some(present);
}
