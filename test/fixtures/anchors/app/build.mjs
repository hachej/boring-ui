// Turns `corpus.mjs` pages into anchor-conformance cases: each page is rendered in HappyDOM (no scripts, no loading) and serialized
// with the real WP3 policy; the anchor is captured with the real `anchorOf`; `evaluated` is `pageDigest(snapshot)`.
import { Window } from 'happy-dom';
import { anchorOf, createPrivacyPolicy, pageDigest, rangeOf, serializePage } from '@hachej/boring-feedback/page';
import { appCorpus } from './corpus.mjs';

export const corpusPolicy = createPrivacyPolicy();

export function openPage(html) {
  const window = new Window({ url: 'https://fictional.invalid/settings', settings: {
    enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true,
  } });
  window.document.body.innerHTML = html;
  return { window, document: window.document, root: window.document.body };
}

function expectation(step, root, snapshot) {
  const range = element => {
    const found = rangeOf(element, root, snapshot);
    if (found === undefined) throw new Error(`step "${step.name}": a marked element is not in the snapshot`);
    return found;
  };
  if (step.expect === 'exact' || step.expect === 'moved') {
    const targets = root.querySelectorAll('[data-expect="target"]');
    if (targets.length !== 1) throw new Error(`step "${step.name}": needs exactly one target`);
    return { kind: step.expect, range: range(targets[0]) };
  }
  if (step.expect === 'ambiguous') return { kind: 'ambiguous', candidates: Array.from(root.querySelectorAll('[data-expect="candidate"]'), range) };
  return { kind: step.expect };
}

/** The kit's cases, plus each page's serialized snapshot for inspection. */
export async function buildAppCorpus(policy = corpusPolicy) {
  const cases = [];
  for (const item of appCorpus) {
    const capturePage = openPage(item.capture);
    let anchor = item.anchor;
    const captureSnapshot = serializePage(capturePage.root, policy);
    if (anchor === undefined) {
      const picked = capturePage.document.querySelector('[data-pick]');
      const captured = anchorOf(picked, policy, { root: capturePage.root });
      if (captured.kind !== 'captured') throw new Error(`case "${item.name}": capture refused: ${captured.reason}`);
      anchor = captured.anchor;
    }
    capturePage.window.happyDOM.close();
    const steps = [];
    for (const step of item.steps) {
      const page = openPage(step.page);
      const snapshot = serializePage(page.root, policy, step.limits ?? {});
      steps.push({ name: step.name, snapshot, evaluated: await pageDigest(snapshot), expect: expectation(step, page.root, snapshot) });
      page.window.happyDOM.close();
    }
    cases.push({ name: item.name, group: item.group, capture: { snapshot: captureSnapshot, anchor }, steps });
  }
  return cases;
}
