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

export function renderBadgeThemeVariables(theme) {
  return Object.entries(theme)
    .map(([name, [background, foreground]]) => `--${name}: ${background}; --on-${name}: ${foreground};`)
    .join('\n  ')
}
