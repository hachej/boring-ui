/** Runs in Chromium against real mounted blocks, never against synthetic stand-in components. */
export function auditDesign({ groups, palette, radiusBindings }) {
  const root = getComputedStyle(document.documentElement);
  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const resolve = (property, value) => {
    probe.style.removeProperty(property);
    probe.style.setProperty(property, value);
    return getComputedStyle(probe).getPropertyValue(property);
  };
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = value => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const color = token => rgba(resolve('color', `var(--${token})`));
  const colors = palette.filter(token => root.getPropertyValue(`--${token}`).trim()).map(color);
  // Compare painted channels: translucent native variants quantize during canvas
  // premultiplication, so unpremultiplied RGB can differ by several integers.
  const equalColor = (left, right) => left.slice(0, 3).every((channel, index) => Math.abs(channel - right[index]) * right[3] / 255 <= 1);
  const normalizeShadow = value => value === 'none' ? '' : value.split(/,(?![^(]*\))/).map(part => part.trim()).filter(part => !/^rgba\([^)]*,\s*0\)/.test(part)).join(', ');
  const shadows = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'].filter(size => root.getPropertyValue(`--shadow-${size}`).trim()).map(size => normalizeShadow(resolve('box-shadow', `var(--shadow-${size})`)));
  const radii = ['0px', resolve('border-radius', 'var(--radius)')];
  for (const name of new Set([...Object.keys(radiusBindings), ...['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'].map(size => `radius-${size}`)])) {
    const value = root.getPropertyValue(`--${name}`).trim() ? `var(--${name})` : radiusBindings[name];
    if (value) radii.push(resolve('border-radius', value));
  }
  const fonts = ['sans', 'mono', 'display', 'heading'].filter(name => root.getPropertyValue(`--font-${name}`).trim()).map(name => resolve('font-family', `var(--font-${name})`));
  // A border width computes to zero with border-style:none; resolve the token as a length.
  const borderWidth = resolve('width', root.getPropertyValue('--border-width').trim() || '1px');
  const results = groups.map(group => ({ id: group.id, name: group.name, mode: group.mode, elements: 0, checks: 0, violations: [] }));
  for (const element of document.querySelectorAll('body *')) {
    if (element === probe || element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !element.checkVisibility() || !element.closest('.pi-chat, .boring-viewer, .app-shell, [data-boring=file-tree], [data-boring=feedback], [data-slot=dropdown-menu-content]')) continue;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) continue;
    // A PDF's foreign document and rich editor document are content exceptions; their chrome remains audited.
    if (element.closest('.tiptap, .ProseMirror') || element.matches('iframe, canvas, img, script, style, link')) continue;
    // A semantic list/card/menu button remains in its own unmigrated group. Native
    // Button/Toggle/Switch instances are group 1 wherever another block composes them.
    const nativeControl = ['button', 'toggle', 'switch'].includes(element.dataset.slot);
    let legacy;
    if (!nativeControl && element.matches('button, [role=switch]')) {
      if (element.matches('[role^=menuitem], [data-slot^=dropdown-menu-]') || element.closest('.app-shell [role=dialog]')) legacy = '2';
      else if (element.closest('[data-boring=file-tree], [data-testid=conversation-row], .boring-feedback-candidates, .boring-feedback-list') || element.matches('[data-testid=revision-item]')) legacy = '4';
      else if (element.matches('[data-testid=artifact-card], [data-testid=message-file]') || element.closest('[data-testid=question-card], [data-testid=approval-card]')) legacy = '6';
      else if (element.closest('.boring-markdown-toolbar, .boring-markdown-bubble, .boring-html-toolbar') || element.hasAttribute('data-mode') || element.matches('[role=tab]')) legacy = '7';
      else if (element.matches('[data-testid=message-mention], [data-testid=feedback-fallback]') || element.closest('[data-testid=message-files]')) legacy = '5';
    }
    let index = legacy ? groups.findIndex(group => group.id === legacy) : -1;
    for (let at = element; at && index < 0; at = at.parentElement) index = groups.findIndex(group => (at === element || group.id !== '1') && at.matches(group.selector));
    if (index < 0) continue;
    const result = results[index], style = getComputedStyle(element);
    result.elements++;
    const target = `${element.tagName.toLowerCase()}${element.dataset.testid ? `[data-testid=${element.dataset.testid}]` : element.dataset.slot ? `[data-slot=${element.dataset.slot}]` : ''}`;
    const check = (family, actual, expected, passed) => {
      result.checks++;
      if (!passed) result.violations.push({ target, family, actual, expected });
    };
    // Resolve native geometry outside the block's ancestor selectors. The consumer's
    // unchanged component owns geometry such as a Switch's circular track; blocks
    // may not override it, even with a different otherwise-valid radius token.
    const reference = nativeControl ? element.cloneNode(true) : null;
    const referenceRoot = reference ? document.createElement('div') : null;
    if (referenceRoot) {
      // The examples scope standard preflight to .pi-chat rather than reset the
      // whole host app. Retain that neutral baseline, not the original ancestors.
      referenceRoot.className = 'pi-chat'; referenceRoot.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none';
      reference.removeAttribute('style'); referenceRoot.append(reference); document.body.append(referenceRoot);
    }
    const host = reference ? getComputedStyle(reference) : null;
    for (const edge of ['Top', 'Right', 'Bottom', 'Left']) if (host || parseFloat(style[`border${edge}Width`]) > 0) {
      const expected = host ? host[`border${edge}Width`] : borderWidth;
      check('border-width', style[`border${edge}Width`], expected, style[`border${edge}Width`] === expected);
    }
    for (const corner of ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight']) {
      const expected = host ? [host[`border${corner}Radius`]] : radii;
      check('radius', style[`border${corner}Radius`], expected, expected.includes(style[`border${corner}Radius`]));
    }
    // Native focus rings are focus indicators, not elevation shadows.
    const shadow = normalizeShadow(style.boxShadow).split(/,(?![^(]*\))/).filter(part => !(nativeControl && element.matches(':focus-visible') && /0px 0px 0px [1-9]/.test(part))).join(', ').trim();
    referenceRoot?.remove();
    if (shadow) check('shadow', shadow, shadows, shadows.includes(shadow));
    const text = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (text || element.matches('input, textarea, select')) {
      check('font', style.fontFamily, fonts, fonts.includes(style.fontFamily));
      check('text-color', style.color, 'theme token palette', colors.some(value => equalColor(value, rgba(style.color))));
    }
    const background = rgba(style.backgroundColor);
    if (background[3] > 0) check('background-color', style.backgroundColor, 'theme token palette', colors.some(value => equalColor(value, background)));
  }
  const over = (foreground, background) => {
    const alpha = foreground[3] / 255;
    return foreground.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha));
  };
  const luminance = channels => channels.map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const pairs = [['foreground', 'background'], ['card-foreground', 'card'], ['popover-foreground', 'popover'], ['primary-foreground', 'primary'], ['secondary-foreground', 'secondary'], ['muted-foreground', 'muted'], ['accent-foreground', 'accent']];
  const contrast = pairs.map(([foreground, background]) => {
    const bg = over(color(background), color('background'));
    const fg = over(color(foreground), [...bg, 255]);
    const a = luminance(fg), b = luminance(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return { foreground, background, ratio, pass: ratio >= 4.5 };
  });
  const background = color('background');
  probe.remove();
  return { groups: results, contrast, tokens: { borderWidth, radius: root.getPropertyValue('--radius').trim(), font: fonts, shadows, background } };
}
