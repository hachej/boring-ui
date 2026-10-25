import assert from 'node:assert/strict';

/** Drives all five hash buckets through the same public room, after screenshots and product-flow assertions. */
export async function auditAgentContrast(browser) {
  await browser.evaluate(`(async () => {
    const ids = ['audit-a', 'audit-b', 'audit-c', 'audit-d', 'audit-e'];
    const members = await window.__SHARED__.members('admin');
    window.__SHARED__.emit({ type: 'members', conversationId: 'admin', members: [...members, ...ids.map(id => ({ id, name: id, kind: 'agent' }))] });
    for (const id of ids) window.__SHARED__.emit({ type: 'message', message: { id, conversationId: 'admin', author: id, at: new Date().toISOString(), text: '@' + id + ' Contrast check.' } });
  })()`);
  await browser.until('five public agent colour buckets', "document.querySelectorAll('[data-shared-message^=audit-]').length === 5");
  const result = await browser.evaluate(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map(value => value / 255); };
    const luminance = rgb => rgb.slice(0, 3).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const background = element => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) layers.unshift(rgba(getComputedStyle(node).backgroundColor));
      return layers.reduce((base, layer) => base.map((value, index) => layer[index] * layer[3] + value * (1 - layer[3])), [1, 1, 1]);
    };
    return [...document.querySelectorAll('[data-shared-message^=audit-]')].map(row => {
      const name = row.querySelector('[data-testid=message-author]'), mention = row.querySelector('[data-testid=message-mention]');
      const icon = row.querySelector('[data-testid=message-author-row] svg[data-lucide=sparkle]');
      const candidate = rgba(getComputedStyle(icon).color);
      return { token: name.dataset.agentColor, avatar: row.querySelector('[data-testid=message-author-row] [data-testid=member-avatar]').dataset.agentColor, mention: mention.dataset.agentColor ?? null,
        iconRatio: contrast(candidate, background(icon)),
        headingRatio: contrast(rgba(getComputedStyle(name).color), background(name)), mentionRatio: contrast(rgba(getComputedStyle(mention).color), background(mention)),
        chartHeadingRatio: contrast(candidate, background(name)), chartMentionRatio: contrast(candidate, background(mention)) };
    });
  })()`);
  assert.equal(new Set(result.map(entry => entry.token)).size, 5, 'all five tokens render through the public entry');
  for (const entry of result) {
    assert.equal(entry.avatar, entry.token); assert.equal(entry.mention, null, 'mentions share the agents’ info colour');
    assert.ok(entry.headingRatio >= 4.5 && entry.mentionRatio >= 4.5 && entry.iconRatio >= 3, JSON.stringify(entry));
  }
  return result;
}

/**
 * WCAG AA (4.5:1) for the small muted text the WhatsApp layout adds: times inside bubbles, card lines, notices and day pills,
 * on whatever bubble or page sits behind them, with every ancestor's opacity applied.
 */
export async function auditSmallText(browser, selector = '[data-testid=message-time], [data-testid=request-line], [data-testid=system-line], [data-testid=day-separator] time, [data-testid=pin-quote], [data-testid=jump-latest]') {
  const result = await browser.evaluate(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map(value => value / 255); };
    const luminance = rgb => rgb.slice(0, 3).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const background = element => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) layers.unshift(rgba(getComputedStyle(node).backgroundColor));
      return layers.reduce((base, layer) => base.map((value, index) => layer[index] * layer[3] + value * (1 - layer[3])), [1, 1, 1]);
    };
    const opacity = element => { let value = 1; for (let node = element; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity); return value; };
    return [...document.querySelectorAll(${JSON.stringify(selector)})].filter(element => element.getClientRects().length).map(element => {
      const back = background(element), alpha = opacity(element), text = rgba(getComputedStyle(element).color);
      const seen = back.map((value, index) => text[index] * text[3] * alpha + value * (1 - text[3] * alpha));
      return { what: element.dataset.testid || element.parentElement.dataset.testid || element.tagName, text: element.textContent.trim().slice(0, 40), ratio: Math.round(contrast(seen, back) * 100) / 100 };
    });
  })()`);
  assert.ok(result.length > 0, 'small text to audit');
  for (const entry of result) assert.ok(entry.ratio >= 4.5, JSON.stringify(entry));
  return result;
}
