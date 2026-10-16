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
  const equalColor = (left, right) => left.every((channel, index) => Math.abs(channel - right[index]) <= 1);
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
    if (element === probe || element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !element.checkVisibility() || !element.closest('.pi-chat, .boring-viewer, .app-shell, [data-boring], [role=menu][data-slot=dropdown-menu-content], [role=dialog]')) continue;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) continue;
    // A PDF's foreign document and rich editor document are content exceptions; their chrome remains audited.
    if (element.closest('.tiptap, .ProseMirror') || element.matches('iframe, canvas, img, script, style, link')) continue;
    // Nearest owning surface wins. A transcript ancestor must not swallow a card's coverage.
    let index = -1;
    for (let at = element; at && index < 0; at = at.parentElement) index = groups.findIndex(group => (at === element || group.id !== '1') && at.matches(group.selector));
    if (index < 0) continue;
    const result = results[index], style = getComputedStyle(element);
    result.elements++;
    const target = `${element.tagName.toLowerCase()}${element.dataset.testid ? `[data-testid=${element.dataset.testid}]` : element.dataset.slot ? `[data-slot=${element.dataset.slot}]` : ''}`;
    const check = (family, actual, expected, passed) => {
      result.checks++;
      if (!passed) result.violations.push({ target, family, actual, expected });
    };
    for (const edge of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(style[`border${edge}Width`]) > 0) check('border-width', style[`border${edge}Width`], borderWidth, style[`border${edge}Width`] === borderWidth);
    for (const corner of ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight']) check('radius', style[`border${corner}Radius`], radii, radii.includes(style[`border${corner}Radius`]));
    const shadow = normalizeShadow(style.boxShadow);
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
  probe.remove();
  return { groups: results, contrast, tokens: { borderWidth, radius: root.getPropertyValue('--radius').trim(), font: fonts, shadows, background: color('background') } };
}
