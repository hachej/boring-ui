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
      const icon = row.querySelector('[data-testid=message-avatar] svg[data-lucide=bot]');
      const candidate = rgba(getComputedStyle(icon).color);
      return { token: name.dataset.agentColor, avatar: row.querySelector('[data-testid=message-avatar] [data-testid=member-avatar]').dataset.agentColor, mention: mention.dataset.agentColor,
        headingRatio: contrast(rgba(getComputedStyle(name).color), background(name)), mentionRatio: contrast(rgba(getComputedStyle(mention).color), background(mention)),
        chartHeadingRatio: contrast(candidate, background(name)), chartMentionRatio: contrast(candidate, background(mention)) };
    });
  })()`);
  assert.equal(new Set(result.map(entry => entry.token)).size, 5, 'all five tokens render through the public entry');
  for (const entry of result) {
    assert.equal(entry.avatar, entry.token); assert.equal(entry.mention, entry.token);
    assert.ok(entry.headingRatio >= 4.5 && entry.mentionRatio >= 4.5, JSON.stringify(entry));
  }
  return result;
}
