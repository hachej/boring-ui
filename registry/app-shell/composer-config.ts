// The composer's placement as flags. Today's `composer` strings are presets of this config; every place that used to compare `composer` to a string reads the resolved flags instead,
// and the strip's actions (the chevron and what the state offers) and the tray header's buttons read ONE action table. `composer` takes a preset string, this config object, or a
// function of the viewport and route that gives the object. The circle launcher is the first non-preset behaviour: invalid combinations throw, naming the fix.
import type { AgentComposer, ComposerPlace, ComposerSignals, ConversationSize, Level, ResolvedComposer } from './layer-context';
export type { Level } from './layer-context';
export type { ComposerLauncher, ResolvedComposer } from './layer-context';

/** A corner in logical terms (a right-to-left page mirrors it): `bottom-end` is the bottom right in a left-to-right page. */
export type Corner = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';
/** A distance: px as a number, or a CSS length (`'var(--phone-band-h)'`). */
export type Length = number | string;
/** What a launcher steps around: a selector of the page's fixed elements, or a live rectangle (`null`: nothing there now). */
export type Avoid = string | (() => DOMRect | null);
/** What a `composer` function reads: the viewport and the route. */
export interface ComposerEnv { readonly phone: boolean; readonly width: number; readonly route?: string | undefined }

interface ComposerCommon {
  /** Names this launcher: the storage keys, `data-composer`, and Ctrl or Cmd + J (the first launcher answers). Absent: today's keys. */
  readonly id?: string;
  readonly at?: {
    readonly place?: 'bottom' | 'float' | Corner | 'right-edge';
    /** The gap to the corner's two edges, 16 and 16 by default. A phone's tab bar is added when `block` is not given. */
    readonly offset?: { readonly inline?: Length; readonly block?: Length };
    /** The order among launchers on one corner, lowest nearest the corner: `auto` (default) is by mount order. */
    readonly stack?: 'auto' | number;
    readonly remember?: 'local' | 'session' | false;
  };
  /** Publishes the launcher's footprint as `--composer-reserve-block` and `--composer-reserve-inline` (default `auto`), which the screens, the notice row and a host's own toasts read. */
  readonly reserve?: 'auto' | 'none';
  /** Rectangles the launcher and its panel step around (a drawer's tab, a band). */
  readonly avoid?: readonly Avoid[];
  /** The launcher's z-index (default 40; its panel is one above): below the app's sheets (50 and up) and above the page. */
  readonly layer?: number;
  /** Controlled when `level` is set: the app reads and sets it through `on.level`. */
  readonly level?: Level;
  readonly defaultLevel?: Level;
  readonly on?: {
    readonly level?: (level: Level) => void;
    readonly signals?: (signals: ComposerSignals) => void;
    /** Shorthand of `handoff.openFull`: hand the conversation to the app's full page. */
    readonly openFull?: (conversationId: string) => void;
  };
  /** The status text beside the folded launcher (`'réfléchit'`), or `null` for none. */
  readonly note?: (signals: ComposerSignals) => string | null;
  /** The pointing tool (`AgentSpec.feedback`): its toggle sits in the panel's title row; `while` is the level taken while annotating (default `folded`). */
  readonly feedback?: { readonly while?: Level };
  /** Adds Open in full: the app's full page for the conversation. */
  readonly handoff?: { readonly openFull: (conversationId: string, context: { readonly empty: boolean }) => void; readonly then?: 'close' | 'stay'; readonly allowEmpty?: boolean };
  /** The full page is on show: the launcher is hidden and the conversation is marked read, in every mounted instance. */
  readonly suspended?: boolean;
}

/** The config a preset stands for (the spec's key names: `at`, `side`). */
export type ComposerConfig = ComposerCommon & (
  | { readonly launcher: 'bar'; readonly sizes?: readonly ConversationSize[]; readonly dock?: boolean; readonly fold?: 'circle' | false; readonly float?: boolean | { readonly movable?: boolean } }
  | { readonly launcher: 'circle'; readonly sizes?: readonly ConversationSize[] }
  | { readonly launcher: 'tab'; readonly sizes?: readonly ConversationSize[]; readonly side?: { readonly mode?: 'push' | 'overlay' | 'auto'; readonly width?: number | string } }
  | { readonly launcher: 'header'; readonly float?: boolean });
/** What `composer` takes: a preset string, the config object, or a function of the viewport and route that gives the object. */
export type ComposerInput = AgentComposer | ComposerConfig | ((env: ComposerEnv) => ComposerConfig);

/** The presets, one per string. `bar` with the shell's `floatingComposer` and the standalone `FloatingComposer` are the two variants below. */
export const COMPOSER_PRESETS = {
  dock: { launcher: 'header', float: true },
  content: { launcher: 'bar', sizes: ['open'], dock: true },
  bar: { launcher: 'bar', sizes: ['open', 'grown', 'full'], dock: true },
  explore: { launcher: 'tab', side: { mode: 'auto' }, at: { place: 'right-edge' } },
} as const satisfies Record<AgentComposer, ComposerConfig>;

/** `composer="bar"` with `floatingComposer`: the bar may float and fold to its circle (remembered). */
export const BAR_FLOATING_PRESET = { ...COMPOSER_PRESETS.bar, fold: 'circle', float: { movable: true }, at: { remember: 'local' } } as const satisfies ComposerConfig;
/** The standalone `FloatingComposer`: a bar with no dock column; `start="icon"` is a default level, not a different preset. */
export const FLOATING_COMPOSER_PRESET = { launcher: 'bar', sizes: ['open', 'grown', 'full'], dock: false, fold: 'circle', float: { movable: true } } as const satisfies ComposerConfig;
/** The agent card: levels 0, 1 and 2 are `folded`, `open` and `full`. */
export const AGENT_CARD_PRESET = { launcher: 'bar', sizes: ['open', 'full'], dock: true } as const satisfies ComposerConfig;

/** Where the conversation is, as far as its strip is concerned (the layer's own values). */
export interface StripState {
  readonly expanded: boolean;
  readonly snap: 'closed' | 'peek' | 'half' | 'full';
  readonly trayOpen: boolean;
  readonly dockOpen: boolean;
  readonly size: ConversationSize;
  readonly place: ComposerPlace;
  readonly anchored: boolean;
  /** The layer offers the side dock (false for the standalone entry). */
  readonly docks: boolean;
  /** The agent has a pointing tool (`AgentSpec.feedback`): a circle's title row carries its toggle. */
  readonly feedback?: boolean;
}

/** The one action table: the strip and the tray header draw their ids and test ids from here. Labels, icons and what they do belong to the caller. */
export const STRIP_ACTIONS = {
  conversation: { id: 'chevron', testId: 'agent-bar-conversation' },
  reduce: { id: 'chevron', testId: 'agent-tray-reduce' },
  back: { id: 'chevron', testId: 'agent-full-back' },
  more: { id: 'more', testId: 'agent-tray-grow' },
  full: { id: 'full', testId: 'agent-tray-full' },
  split: { id: 'split', testId: 'agent-tray-dock' },
  float: { id: 'float', testId: 'composer-float' },
  dock: { id: 'dock', testId: 'composer-dock-bottom' },
  minimise: { id: 'minimise', testId: 'composer-minimise' },
  openFull: { id: 'open-full', testId: 'composer-open-full' },
} as const;
export type StripKey = keyof typeof STRIP_ACTIONS;
/** The circle panel's title-row actions: the annotate toggle (an agent with a pointing tool), Open in full (a `handoff`) and Close. Only what the config allows is drawn. */
export const CIRCLE_ACTIONS = {
  annotate: { id: 'annotate', testId: 'composer-annotate-title' },
  openFull: { id: 'open-full', testId: 'composer-open-full' },
  close: { id: 'close', testId: 'agent-layer-close' },
} as const;
export type CircleKey = keyof typeof CIRCLE_ACTIONS;
/** One action of the plan: `open` marks the phone chevron that collapses (its label), the rest is the table's. */
export interface StripPlanItem { readonly key: StripKey | CircleKey; readonly id: string; readonly testId: string; readonly open?: boolean }

const item = (key: StripKey, open?: boolean): StripPlanItem => ({ key, ...STRIP_ACTIONS[key], ...(open === undefined ? {} : { open }) });

const fail = (why: string): never => { throw new Error(`composer: ${why}`); };
const LEVELS: readonly string[] = ['folded', 'open', 'grown', 'full', 'docked'];
const CORNERS: readonly string[] = ['bottom-end', 'bottom-start', 'top-end', 'top-start'];
const checkLength = (name: string, value: unknown) => { if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value)) && !(typeof value === 'string' && value.trim() !== '')) fail(`\`at.offset.${name}\` is a number of px or a CSS length such as 'var(--tabbar-h)'`); };

/** The levels a launcher can be at: the circle has two, a bar the sizes and the dock its config allows, a tab and the header trigger their own. */
export function levelsOf(config: ComposerConfig, standalone: boolean): readonly Level[] {
  switch (config.launcher) {
    case 'circle': case 'tab': return ['folded', 'open'];
    case 'header': return ['folded', 'open', 'docked'];
    case 'bar': { const sizes = config.sizes ?? ['open']; return ['folded', 'open', ...(sizes.includes('grown') ? ['grown' as const] : []), ...(sizes.includes('full') ? ['full' as const] : []), ...(config.dock !== false && !standalone ? ['docked' as const] : [])]; }
  }
}

/** The rules every launcher shares (`id`, `at`, `level`, `on`, `handoff`, `feedback`...): every invalid combination names the fix. */
function checkCommon(config: ComposerConfig, standalone: boolean): void {
  const { at, level, defaultLevel, on, handoff, feedback, sizes } = config as ComposerConfig & { readonly sizes?: readonly ConversationSize[] };
  const stack = at?.stack;
  const circle = config.launcher === 'circle';
  if (circle && sizes?.some(size => size !== 'open')) fail("a circle opens one panel: take 'grown' and 'full' out of `sizes`; to show the whole conversation on a page, give `handoff.openFull` (the page is your route)");
  if (at?.place !== undefined) {
    if (circle && !CORNERS.includes(at.place)) fail(`a circle sits in a corner: \`at.place\` is one of ${CORNERS.map(corner => `'${corner}'`).join(', ')}, not '${at.place}'`);
    if (!circle && !CORNERS.includes(at.place) && at.place !== 'bottom' && at.place !== 'float' && at.place !== 'right-edge') fail(`\`at.place\` is 'bottom', 'float', 'right-edge' or one of ${CORNERS.map(corner => `'${corner}'`).join(', ')}, not '${String(at.place)}'`);
  }
  const allowed = levelsOf(config, standalone);
  for (const [name, value] of [['level', level], ['defaultLevel', defaultLevel]] as const) {
    if (value === undefined) continue;
    if (allowed.includes(value)) continue;
    if (circle) fail(LEVELS.includes(value) ? `a circle has two levels, 'folded' (the circle) and 'open' (the panel): \`${name}: '${value}'\` is for the bar; to show the whole conversation, give \`handoff.openFull\`` : `\`${name}\` is 'folded' or 'open'`);
    fail(LEVELS.includes(value) ? `a ${config.launcher} launcher has no '${value}' level (it has ${allowed.map(one => `'${one}'`).join(', ')}): ${value === 'docked' ? 'set `dock: true` (the standalone composer has no dock)' : `add '${value}' to \`sizes\``}, or ask for one of those` : `\`${name}\` is one of ${allowed.map(one => `'${one}'`).join(', ')}`);
  }
  if (level !== undefined && !on?.level) fail('`level` is controlled: pass `on.level` to change it, or use `defaultLevel` for a start the person can change');
  if (handoff && on?.openFull) fail('`handoff.openFull` and `on.openFull` both hand the conversation to the full page: keep one');
  if (handoff?.then !== undefined && handoff.then !== 'close' && handoff.then !== 'stay') fail("`handoff.then` is 'close' (default) or 'stay'");
  if (feedback?.while !== undefined && !allowed.includes(feedback.while)) fail(`\`feedback.while\` is the level taken while annotating: one of ${allowed.map(one => `'${one}'`).join(', ')} ('folded' steps the panel aside, the default of a circle)`);
  if (stack !== undefined && stack !== 'auto' && !(Number.isInteger(stack) && stack >= 0)) fail("`at.stack` is 'auto' or a whole number from 0 (the one nearest the corner)");
  if (config.layer !== undefined && !Number.isFinite(config.layer)) fail('`layer` is a z-index number');
  if (config.reserve !== undefined && config.reserve !== 'auto' && config.reserve !== 'none') fail("`reserve` is 'auto' (default) or 'none'");
  if (config.avoid !== undefined && !(Array.isArray(config.avoid) && config.avoid.every(entry => typeof entry === 'string' || typeof entry === 'function'))) fail('`avoid` is a list of selectors and functions that give a rectangle (or null)');
  checkLength('inline', at?.offset?.inline); checkLength('block', at?.offset?.block);
}

const clean = (config: ComposerConfig, standalone: boolean, given: boolean): ResolvedComposer => {
  if (config.id !== undefined && (typeof config.id !== 'string' || config.id.trim() === '')) fail('`id` is a non-empty string');
  const sizes = 'sizes' in config && config.sizes ? config.sizes : config.launcher === 'tab' || config.launcher === 'header' ? [] : ['open'] as const;
  if ('sizes' in config && config.sizes && config.sizes.length === 0) fail('`sizes` is empty');
  if (config.launcher === 'circle' && ('dock' in config || 'fold' in config || 'float' in config)) fail('a circle launcher is always folded: no `dock`, `fold` or `float`');
  if (config.launcher === 'tab' && ('dock' in config || 'fold' in config || 'float' in config)) fail('a tab launcher takes no `dock`, `fold` or `float`');
  if (config.launcher === 'header' && 'sizes' in config) fail('a header launcher has no sizes: it is the docked trigger');
  if (config.launcher !== 'bar' && 'fold' in config) fail('`fold` is for a bar');
  if (given && standalone && config.launcher === 'header') fail('`FloatingComposer` has no header trigger: use launcher \'bar\' or \'circle\'');
  if (given && standalone && config.launcher === 'bar' && config.dock === true) fail('`FloatingComposer` has no side dock: leave `dock` out (or set it to false)');
  checkCommon(config, standalone);
  const float = config.launcher === 'bar' || config.launcher === 'header' ? config.float === true || (typeof config.float === 'object' && config.float !== null) : false;
  const fold = config.launcher === 'bar' ? config.fold === 'circle' : false;
  if (config.launcher === 'bar' && fold !== (config.float !== undefined && config.float !== false)) fail('a bar folds to its circle exactly when it floats: set `fold` and `float` together');
  const bar = config.launcher === 'bar' && sizes.includes('grown');
  return { launcher: config.launcher, sizes, dock: config.launcher === 'bar' ? !standalone && config.dock !== false : config.launcher === 'header', floatable: config.launcher === 'bar' && float && fold && bar,
    contentColumn: config.launcher === 'bar', bar, explore: config.launcher === 'tab', circle: config.launcher === 'circle', id: config.id };
};

/**
 * The flags of a `composer` string (or config) and, given the conversation's state, the ordered strip actions. `floatingComposer` only turns the `bar` preset into
 * its floating variant (as today: `content` ignores it). `standalone` is the `FloatingComposer` entry (no side dock, no header trigger); `legacy` names the old props the
 * caller was given next to an object (`floatingComposer`, `storage`, `start`, `onOpenFull`), which the object replaces. Invalid combinations throw.
 */
export function resolveComposer(input: { readonly composer?: AgentComposer | ComposerConfig | undefined; readonly floatingComposer?: boolean | undefined; readonly state?: StripState | undefined; readonly standalone?: boolean | undefined; readonly legacy?: readonly string[] | undefined }): { readonly flags: ResolvedComposer; readonly config: ComposerConfig; readonly actions: readonly StripPlanItem[] } {
  const { composer = 'dock', floatingComposer = false, state, standalone = false, legacy = [] } = input;
  let config: ComposerConfig;
  if (typeof composer === 'string') {
    if (!(composer in COMPOSER_PRESETS)) throw new Error(`composer: "${String(composer)}" is not a composer preset`);
    config = composer === 'bar' && floatingComposer ? BAR_FLOATING_PRESET : COMPOSER_PRESETS[composer];
  } else {
    if (typeof composer !== 'object' || composer === null) fail('`composer` is a preset string, a config object or a function that gives one');
    if (floatingComposer) throw new Error('composer: a composer config replaces `floatingComposer`: set `fold` and `float` on it');
    if (legacy.length > 0) fail(`a composer config replaces ${legacy.map(name => `\`${name}\``).join(', ')}: put it on the config (\`at.remember\`, \`defaultLevel\`, \`handoff.openFull\`) and remove the prop`);
    config = composer;
  }
  const flags = clean(config, standalone, typeof composer === 'object');
  return { flags, config, actions: state ? stripPlan(flags, state, config) : [] };
}

/**
 * The composer one screen shows (`NavItem.composer`): the app's own when the screen says nothing; `false` is the app's composer with `suspended` (hidden here, the conversation read); a config object replaces it for this screen.
 * `floating` is the shell's `floatingComposer`, which a config object replaces (it throws next to one), so it is dropped from whatever turns into an object.
 */
export function composerForScreen(base: AgentComposer | ComposerConfig | undefined, floating: boolean, screen: ComposerConfig | false | undefined): { readonly composer: AgentComposer | ComposerConfig | undefined; readonly floating: boolean } {
  if (screen === undefined) return { composer: base, floating };
  if (screen === false) return { composer: { ...resolveComposer({ composer: base, floatingComposer: floating }).config, suspended: true }, floating: false };
  return { composer: screen, floating: false };
}

/** The config object the layer was given (`undefined` for a string preset): `Internal.composerConfig` holds it untyped. */
export const configOf = (layer: { readonly composerConfig: { readonly current: unknown } }): ComposerConfig | undefined => layer.composerConfig.current as ComposerConfig | undefined;

/** The strip in a state, as today: the chevron first, then what the state offers. A circle's panel has only what its config allows: Open in full (a `handoff`) and Close. A `handoff` adds Open in full to a bar's strip while the conversation is open (the full page is the app's own, never a level). */
export function stripPlan(flags: ResolvedComposer, s: StripState, config?: ComposerConfig): readonly StripPlanItem[] {
  const plan = basePlan(flags, s, config);
  const handoff = config?.handoff !== undefined || config?.on?.openFull !== undefined;
  const open = s.expanded ? s.trayOpen && s.size !== 'full' : s.snap === 'half' || s.snap === 'full';
  return handoff && !flags.circle && open && plan.length > 0 ? [...plan, item('openFull')] : plan;
}

function basePlan(flags: ResolvedComposer, s: StripState, config?: ComposerConfig): readonly StripPlanItem[] {
  if (flags.circle) {
    if (s.snap === 'closed') return [];
    const handoff = config?.handoff !== undefined || config?.on?.openFull !== undefined;
    return [...(s.feedback ? [{ key: 'annotate' as const, ...CIRCLE_ACTIONS.annotate }] : []), ...(handoff ? [{ key: 'openFull' as const, ...CIRCLE_ACTIONS.openFull }] : []), { key: 'close' as const, ...CIRCLE_ACTIONS.close }];
  }
  if (!s.expanded) {
    const open = s.snap === 'half' || s.snap === 'full';
    return [item('conversation', open), ...(s.snap === 'half' ? [item('more')] : [])];
  }
  if (s.trayOpen && s.size === 'full') return [item('back')];
  if (s.dockOpen) return [];
  const floats = flags.floatable && !s.anchored;
  if (s.place === 'float') return [s.trayOpen ? item('reduce') : item('conversation'), item('dock'), item('minimise')];
  const places = floats ? [item('float'), item('minimise')] : [];
  if (s.trayOpen) return [item('reduce'), ...(s.size === 'open' ? [item('more')] : []), ...(s.docks ? [item('split')] : []), item('full'), ...places];
  return [item('conversation'), item('full'), ...places];
}
