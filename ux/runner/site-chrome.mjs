// The showcase's frame, in the manner of a component library's docs: a left navigation (a menu on a phone), a header with the theme switch, a footer link.
export const esc = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const DEFAULT_PAGE = 'component-design-system';
export const DOCS = 'https://github.com/hachej/boring-ui/blob/main/ux/README.md';

const THEME_BOOT = `try{var t=localStorage.getItem('ux-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){}`;

export const head = (title, depth, description) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title>${description ? `<meta name="description" content="${esc(description)}">` : ''}<link rel="icon" href="data:,"><script>${THEME_BOOT}</script><link rel="stylesheet" href="${depth ? '../' : ''}site.css"><script defer src="${depth ? '../' : ''}site.js"></script></head>`;

// cards: [{ name, meta }]; current: the folder name of the page, or '' for the home page.
function sidebar(cards, current, depth) {
  const up = depth ? '../' : '';
  const section = (level, title) => {
    const list = cards.filter(c => c.meta.level === level);
    return list.length ? `<p class="nav-title">${title}</p><ul>${list.map(c => `<li><a href="${up}${esc(c.name)}/index.html"${c.name === current ? ' aria-current="page"' : ''}>${esc(c.meta.title)}</a></li>`).join('')}</ul>` : '';
  };
  return `<aside class="side" id="side" aria-label="Pages"><a class="brand" href="${up}index.html">Boring UI</a>${section('layout', 'Layouts')}${section('component', 'Components')}</aside>`;
}

export function page({ title, description, depth, cards, current, body }) {
  const up = depth ? '../' : '';
  return `${head(title, depth, description)}<body><div class="shell">${sidebar(cards, current, depth)}<div class="content">
<header class="bar"><button type="button" class="icon-btn menu" id="menu" aria-controls="side" aria-expanded="false">Menu</button><a class="brand-sm" href="${up}index.html">Boring UI</a><span class="grow"></span><button type="button" class="icon-btn" id="theme" aria-pressed="false">Dark</button></header>
<main>${body}
<footer>Kit ${esc(cards[0]?.meta.kitVersion)} · commit ${esc(cards[0]?.meta.commit)} · <a href="${DOCS}">How this site is made</a></footer></main></div></div></body></html>`;
}

// A demo page: ONE top bar (the page menu, the Phone and Desktop switch, the theme switch) and the app filling the rest. cards: [{ name, meta }]; current: a card name.
export function framePage({ title, description, depth, body, cards, current }) {
  const up = depth ? '../' : '';
  const group = (label, list) => list.length ? `<optgroup label="${label}">${list.map(c => `<option value="${up}${esc(c.name)}/index.html"${c.name === current ? ' selected' : ''}>${esc(c.meta.title)}</option>`).join('')}</optgroup>` : '';
  // Start: the design system (the home), then the agent cards; the rest follows by level.
  const START = [DEFAULT_PAGE, 'component-agent-card'], first = START.flatMap(name => cards.filter(c => c.name === name)), rest = cards.filter(c => !START.includes(c.name));
  const menu = `<select class="icon-btn" id="pages" aria-label="Page">${group('Start', first)}${group('Layouts', rest.filter(c => c.meta.level === 'layout'))}${group('Components', rest.filter(c => c.meta.level === 'component'))}</select>`;
  return `${head(title, depth, description)}<body class="app"><header class="bar">${menu}${body.switcher}${body.play}<span class="grow"></span><button type="button" class="icon-btn" id="theme" aria-pressed="false">Dark</button></header>${body.stage}</body></html>`;
}
