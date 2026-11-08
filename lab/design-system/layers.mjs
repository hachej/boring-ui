// Theme layering: an app theme is laid over the default theme, so a role the app does not set keeps the default value.
// Pure text functions (no imports) so the node test can load this file as it is.
export const LIGHT_SCOPE = '.ds-light';

/** `:root` rules also apply to the light and dark scopes, so each scope re-declares what it feeds. */
export const scopeLight = css => css.replace(/(^|[}\s,])(:root)(?=[\s,{])/g, `$1$2, ${LIGHT_SCOPE}, .ds-dark`);

/** Splits a stylesheet of plain rules into its light blocks and its dark blocks (a block is dark when every selector names `.dark`). */
export function splitModes(css) {
  const light = [], dark = [];
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const items = match[1].split(',').map(item => item.trim()).filter(Boolean);
    (items.length && items.every(item => item.includes('.dark')) ? dark : light).push(`${match[1].trim()}{${match[2]}}`);
  }
  return { light: light.join('\n'), dark: dark.join('\n') };
}

/**
 * The stylesheet for one theme: the default's light roles, the app's light roles, the default's dark roles, the app's dark roles.
 * Dark blocks come last so `.dark` beats the light selector list (which also names `.ds-dark`). A theme without a `.dark` block keeps the default dark values.
 */
export function layerTheme(defaultCss, appCss) {
  const base = splitModes(defaultCss);
  if (appCss == null || appCss === defaultCss) return `${scopeLight(base.light)}\n${base.dark}`;
  const over = splitModes(appCss);
  return [scopeLight(base.light), scopeLight(over.light), base.dark, over.dark].join('\n');
}
