export const LIGHT_BADGE_THEME = {
  accent: ['#3b5bdb', '#ffffff'],
  'cat-prod': ['#3b5bdb', '#ffffff'],
  'cat-test': ['#2f9e44', '#07170b'],
  'cat-docs': ['#f08c00', '#211200'],
  'cat-config': ['#7048e8', '#ffffff'],
  'cat-generated': ['#868e96', '#11151c'],
  good: ['#2f9e44', '#07170b'],
  warn: ['#f08c00', '#211200'],
  bad: ['#e03131', '#ffffff'],
  muted: ['#5b6270', '#ffffff'],
}

export const DARK_BADGE_THEME = {
  accent: ['#7d94ff', '#0d1117'],
  'cat-prod': ['#7d94ff', '#0d1117'],
  'cat-test': ['#6fdc8c', '#0d1117'],
  'cat-docs': ['#ffc078', '#0d1117'],
  'cat-config': ['#d2a8ff', '#0d1117'],
  'cat-generated': ['#8b949e', '#0d1117'],
  good: ['#6fdc8c', '#0d1117'],
  warn: ['#ffc078', '#0d1117'],
  bad: ['#ff8f8f', '#0d1117'],
  muted: ['#9aa4b2', '#0d1117'],
}

export const LIGHT_TEXT_THEME = { surface: '#f7f8fa', inks: { good: '#176b2c', warn: '#8a4b00', bad: '#b42318' } }
export const DARK_TEXT_THEME = { surface: '#12161d', inks: { good: '#6fdc8c', warn: '#ffc078', bad: '#ff8f8f' } }

export const LIGHT_CODE_THEME = {
  surfaces: { code: '#ffffff', add: '#e6ffec', del: '#ffebe9' },
  inks: { kw: '#6639b7', str: '#075d28', num: '#034b8f', com: '#4b5563' },
}

export const DARK_CODE_THEME = {
  surfaces: { code: '#0d1117', add: '#0f2f1c', del: '#3a1417' },
  inks: { kw: '#d2a8ff', str: '#7ee787', num: '#79c0ff', com: '#b7c0cc' },
}

export function renderBadgeThemeVariables(theme) {
  return Object.entries(theme)
    .map(([name, [background, foreground]]) => `--${name}: ${background}; --on-${name}: ${foreground};`)
    .join('\n  ')
}

export function renderTextThemeVariables(theme) {
  return Object.entries(theme.inks).map(([name, color]) => `--${name}-ink: ${color};`).join('\n  ')
}

export function renderCodeThemeVariables(theme) {
  return [
    `--code-bg: ${theme.surfaces.code}; --add-bg: ${theme.surfaces.add}; --del-bg: ${theme.surfaces.del};`,
    ...Object.entries(theme.inks).map(([name, color]) => `--t-${name}: ${color};`),
  ].join('\n  ')
}
