// Helpers for the artifact scenarios (not a scenario: files starting with `_` are skipped by the loader).
export function artifactKit(t) {
  const { browser, q, qa, idle } = t;
  const CARDS = '[data-testid=artifact-card][data-state=ready]';
  const PANEL = '[data-testid=artifact-panel]';
  const SIDE = '[data-testid=workspace-panel]';
  const rect = selector => browser.evaluate(`(() => { const r = ${q(selector)}.getBoundingClientRect(); return { x: r.x, y: r.y, w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  // A presented file's card is identified by its path (`id`); `nth` counts the cards of that file, oldest first (each present call is one card).
  const cards = () => browser.evaluate(`${qa(CARDS)}.map(c => ({ id: c.dataset.artifactId, revision: c.dataset.artifactRevision, type: c.dataset.artifactType, title: c.querySelector('[data-testid=artifact-title]').textContent, label: c.querySelector('[data-testid=artifact-type]').textContent }))`);
  const cardWhere = (id, nth) => `${qa(CARDS)}.filter(c => c.dataset.artifactId === ${JSON.stringify(id)})[${nth - 1}]`;
  const finished = (count, timeout = 240000) => browser.until(`${count} artifact cards and idle`, `${qa(CARDS)}.length >= ${count} && ${idle}`, timeout);
  const stored = async path => (await (await t.api(`/api/file?path=${encodeURIComponent(`/workspace/${path}`)}`)).json()).text;
  // A click on a card can land while the transcript is still settling after a panel change: click again until it has the effect.
  const openCard = async (id, version, until, label) => {
    for (let attempt = 1; ; attempt++) {
      await browser.click(cardWhere(id, version));
      try { return await browser.until(label, until, 6000); } catch (error) { if (attempt === 3) throw error; }
    }
  };
  const editorText = `(${q(`${PANEL} [role=textbox]`)}?.innerText ?? '')`;
  return { CARDS, PANEL, SIDE, rect, cards, cardWhere, finished, stored, openCard, editorText };
}

export const REPORT_PROMPT = 'Write a short fictional trail report with three short sections about the invented Mount Placeholder loop. Keep your reply to one sentence.';
export const REVISE_PROMPT = 'Revise the trail report by editing the existing file: add a fourth section titled "Safety notes" with two bullet points. Keep the rest. One short sentence for the reply.';
