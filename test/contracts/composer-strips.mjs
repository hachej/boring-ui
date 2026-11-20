// The strip's actions (ids and test ids, in order) in every state of ux/atlas/composer-atlas.json, as they were before the composer became a config (written from the code at 0.5.16).
// One table, two readers: composer-config.test.mjs (the pure plan) and composer-atlas.impl.mjs (the real component's strip). A state of the atlas that is not here nor in NOT_A_STRIP fails.
const conversation = ['chevron', 'agent-bar-conversation'], reduce = ['chevron', 'agent-tray-reduce'], back = ['chevron', 'agent-full-back'], more = ['more', 'agent-tray-grow'], full = ['full', 'agent-tray-full'];
const split = ['split', 'agent-tray-dock'], float = ['float', 'composer-float'], dock = ['dock', 'composer-dock-bottom'], minimise = ['minimise', 'composer-minimise'];

/** Atlas state id: the plan's input (`state`, as the layer holds it) and the strip it must give, `[id, testId]` in order. `wide` states are also read from the real component's DOM. `composer`: the config it is resolved from (the bar with floatingComposer when absent). */
export const STRIPS = {
  bar: { wide: true, state: { expanded: true, snap: 'closed', trayOpen: false, dockOpen: false, size: 'open', place: 'bottom', anchored: false, docks: true }, actions: [conversation, full, float, minimise] },
  tray: { wide: true, state: { expanded: true, snap: 'closed', trayOpen: true, dockOpen: false, size: 'open', place: 'bottom', anchored: false, docks: true }, actions: [reduce, more, split, full, float, minimise] },
  grown: { wide: true, state: { expanded: true, snap: 'closed', trayOpen: true, dockOpen: false, size: 'grown', place: 'bottom', anchored: false, docks: true }, actions: [reduce, split, full, float, minimise] },
  full: { wide: true, state: { expanded: true, snap: 'closed', trayOpen: true, dockOpen: false, size: 'full', place: 'bottom', anchored: false, docks: true }, actions: [back] },
  docked: { wide: true, state: { expanded: true, snap: 'closed', trayOpen: false, dockOpen: true, size: 'open', place: 'bottom', anchored: false, docks: true }, actions: [] },
  floating: { wide: true, state: { expanded: true, snap: 'closed', trayOpen: false, dockOpen: false, size: 'open', place: 'float', anchored: false, docks: true }, actions: [conversation, dock, minimise] },
  'floating-free': { wide: true, state: { expanded: true, snap: 'closed', trayOpen: false, dockOpen: false, size: 'open', place: 'float', anchored: false, docks: true }, actions: [conversation, dock, minimise] },
  'floating-window': { wide: true, state: { expanded: true, snap: 'closed', trayOpen: true, dockOpen: false, size: 'open', place: 'float', anchored: false, docks: true }, actions: [reduce, dock, minimise] },
  // The circle's panel: its own composer (the config), and only the actions the levels allow: Open in full (a handoff) and Close.
  'circle-panel': { wide: true, composer: { launcher: 'circle', handoff: { openFull() {} } }, standalone: true, state: { expanded: true, snap: 'half', trayOpen: false, dockOpen: false, size: 'open', place: 'bottom', anchored: false, docks: false }, actions: [['open-full', 'composer-open-full'], ['close', 'agent-layer-close']] },
  'phone-peek': { state: { expanded: false, snap: 'peek', trayOpen: false, dockOpen: false, size: 'open', place: 'bottom', anchored: false, docks: true }, actions: [conversation] },
  'phone-half': { state: { expanded: false, snap: 'half', trayOpen: false, dockOpen: false, size: 'open', place: 'bottom', anchored: false, docks: true }, actions: [conversation, more] },
  'phone-full': { state: { expanded: false, snap: 'full', trayOpen: false, dockOpen: false, size: 'open', place: 'bottom', anchored: false, docks: true }, actions: [conversation] },
};

/** Every other atlas state, and why it has no strip of this table. */
export const NOT_A_STRIP = {
  icon: 'the folded circle replaces the strip', 'phone-icon': 'the folded circle replaces the strip', 'icon-unread': 'the folded circle', 'icon-needs-you': 'the folded circle',
  'standalone-floating': 'the standalone composer: its own surface, covered by the floating-composer tests', 'standalone-icon': 'the folded circle',
  'explore-closed': 'a tab, no strip', 'explore-push': 'a tab, no strip', 'explore-overlay': 'a tab, no strip', 'explore-sheet': 'a tab, no strip', 'explore-unread': 'a tab, no strip', 'explore-needs-you': 'a tab, no strip',
  'card-folded': 'the agent card has its own header', 'card-composer': 'the agent card', 'card-tray': 'the agent card', 'card-full': 'the agent card', 'card-docked': 'the agent card',
  'notice-host': 'not a composer level', 'bar-working': 'the folded card on the bar: the bar state\'s strip', 'bar-reply': 'the folded card on the bar: the bar state\'s strip', 'bar-question': 'the folded card on the bar: the bar state\'s strip', 'bar-failed': 'the folded card on the bar: the bar state\'s strip',
  circle: 'the folded circle replaces the strip', 'circle-reserve': 'the folded circle replaces the strip', 'circle-notice': 'the folded circle replaces the strip', 'circle-reserve-phone': 'the folded circle replaces the strip', 'circle-notice-phone': 'the folded circle replaces the strip', 'circle-page': 'the app\'s own page: no composer strip',
  'chat-empty': 'the chat alone', 'chat-loading': 'the chat alone', 'chat-error': 'the chat alone', 'chat-ready': 'the chat alone',
};
