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

// The switcher's groups, in order. A page's `group` (in its scenario) picks one; a missing or unknown group falls to "More".
export const GROUPS = ['Start here', 'Composer and layout', 'Chat and files', 'Reference'];
export const FALLBACK_GROUP = 'More';

// A demo page: ONE top bar (the page switcher with search, the page's Options menu, the Phone and Desktop switch, the theme switch) and the app filling the rest.
// cards: [{ name, meta: { title, group?, hint?, order?, keys? } }]; current: a card name. On a phone the bar is the page name and a "more" menu.
export function framePage({ title, description, depth, body, cards, current }) {
  const up = depth ? '../' : '';
  const groupOf = c => (GROUPS.includes(c.meta.group) ? c.meta.group : FALLBACK_GROUP);
  const here = cards.find(c => c.name === current);
  const byOrder = (a, b) => (a.meta.order ?? 100) - (b.meta.order ?? 100) || a.meta.title.localeCompare(b.meta.title);
  const sections = [...GROUPS, FALLBACK_GROUP].map(label => ({ label, list: cards.filter(c => groupOf(c) === label).sort(byOrder) })).filter(g => g.list.length);
  const find = c => [c.meta.title, c.meta.hint, groupOf(c), ...(c.meta.keys ?? [])].filter(Boolean).join(' ').toLowerCase();
  const item = c => `<a class="sw-item" href="${up}${esc(c.name)}/index.html" data-find="${esc(find(c))}"${c.name === current ? ' aria-current="page"' : ''}><span class="sw-title">${esc(c.meta.title)}</span>${c.meta.hint ? `<small class="sw-hint">${esc(c.meta.hint)}</small>` : ''}</a>`;
  const switcher = `<div class="switcher"><button type="button" class="icon-btn sw-btn" id="pages" aria-haspopup="dialog" aria-expanded="false" aria-controls="sw-panel" aria-keyshortcuts="Control+K Meta+K /" title="Pages (Ctrl+K or /)"><span class="sw-name">${esc(here?.meta.title ?? 'Pages')}</span><span aria-hidden="true"> ⌄</span></button>
<div class="sw-backdrop" id="sw-backdrop" hidden></div><div class="sw-panel" id="sw-panel" role="dialog" aria-label="Pages" hidden><input type="search" id="sw-search" class="sw-search" placeholder="Search pages…" aria-label="Search pages" autocomplete="off" spellcheck="false">
<nav class="sw-list" id="sw-list" aria-label="Pages">${sections.map(g => `<section class="sw-section" data-sw-group><p class="sw-group">${esc(g.label)}</p>${g.list.map(item).join('')}</section>`).join('')}</nav><p class="sw-empty" id="sw-empty" hidden>No page matches.</p></div></div>`;
  return `${head(title, depth, description)}<body class="app"><header class="bar">${switcher}<button type="button" class="chip-on" id="options-chip" hidden></button><span class="grow"></span><button type="button" class="icon-btn more" id="more" aria-haspopup="true" aria-expanded="false" aria-controls="tools" aria-label="More">⋯</button><div class="tools" id="tools">${body.options}${body.switcher}<button type="button" class="icon-btn" id="theme" aria-pressed="false">Dark</button></div></header>${body.stage}</body></html>`;
}
