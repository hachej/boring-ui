// The composer's placement as flags. Today's `composer` strings are presets of this config; every place that used to compare `composer` to a string reads the resolved flags instead,
// and the strip's actions (the chevron and what the state offers) and the tray header's buttons read ONE action table. Internal: the public `composer` type is not widened here.
import type { AgentComposer, ComposerLauncher, ComposerPlace, ConversationSize, ResolvedComposer } from './layer-context';
export type { ComposerLauncher, ResolvedComposer } from './layer-context';


/** The config a preset stands for (the spec's key names: `at`, `side`). Only what today's presets use. */
export type ComposerConfig = { readonly id?: string; readonly at?: { readonly place?: 'bottom' | 'float' | 'right-edge'; readonly remember?: 'local' | 'session' | false } } & (
  | { readonly launcher: 'bar'; readonly sizes?: readonly ConversationSize[]; readonly dock?: boolean; readonly fold?: 'circle' | false; readonly float?: boolean | { readonly movable?: boolean } }
  | { readonly launcher: 'circle'; readonly sizes?: readonly ConversationSize[] }
  | { readonly launcher: 'tab'; readonly sizes?: readonly ConversationSize[]; readonly side?: { readonly mode?: 'push' | 'overlay' | 'auto'; readonly width?: number | string } }
  | { readonly launcher: 'header'; readonly float?: boolean });

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
} as const;
export type StripKey = keyof typeof STRIP_ACTIONS;
/** One action of the plan: `open` marks the phone chevron that collapses (its label), the rest is the table's. */
export interface StripPlanItem { readonly key: StripKey; readonly id: string; readonly testId: string; readonly open?: boolean }

const item = (key: StripKey, open?: boolean): StripPlanItem => ({ key, ...STRIP_ACTIONS[key], ...(open === undefined ? {} : { open }) });

const clean = (config: ComposerConfig): ResolvedComposer => {
  const fail = (why: string): never => { throw new Error(`composer: ${why}`); };
  const sizes = 'sizes' in config && config.sizes ? config.sizes : config.launcher === 'tab' || config.launcher === 'header' ? [] : ['open'] as const;
  if ('sizes' in config && config.sizes && config.sizes.length === 0) fail('`sizes` is empty');
  if (config.launcher === 'circle' && ('dock' in config || 'fold' in config || 'float' in config)) fail('a circle launcher is always folded: no `dock`, `fold` or `float`');
  if (config.launcher === 'tab' && ('dock' in config || 'fold' in config || 'float' in config)) fail('a tab launcher takes no `dock`, `fold` or `float`');
  if (config.launcher === 'header' && 'sizes' in config) fail('a header launcher has no sizes: it is the docked trigger');
  if (config.launcher !== 'bar' && 'fold' in config) fail('`fold` is for a bar');
  const float = config.launcher === 'bar' || config.launcher === 'header' ? config.float === true || (typeof config.float === 'object' && config.float !== null) : false;
  const fold = config.launcher === 'bar' ? config.fold === 'circle' : false;
  if (config.launcher === 'bar' && fold !== (config.float !== undefined && config.float !== false)) fail('a bar folds to its circle exactly when it floats: set `fold` and `float` together');
  const bar = config.launcher === 'bar' && sizes.includes('grown');
  return { launcher: config.launcher, sizes, dock: config.launcher === 'bar' ? config.dock !== false : config.launcher === 'header', floatable: config.launcher === 'bar' && float && fold && bar,
    contentColumn: config.launcher === 'bar', bar, explore: config.launcher === 'tab' };
};

/**
 * The flags of a `composer` string (or config) and, given the conversation's state, the ordered strip actions. `floatingComposer` only turns the `bar` preset into
 * its floating variant (as today: `content` ignores it). Invalid combinations throw.
 */
export function resolveComposer(input: { readonly composer?: AgentComposer | ComposerConfig | undefined; readonly floatingComposer?: boolean | undefined; readonly state?: StripState | undefined }): { readonly flags: ResolvedComposer; readonly actions: readonly StripPlanItem[] } {
  const { composer = 'dock', floatingComposer = false, state } = input;
  let config: ComposerConfig;
  if (typeof composer === 'string') {
    if (!(composer in COMPOSER_PRESETS)) throw new Error(`composer: "${String(composer)}" is not a composer preset`);
    config = composer === 'bar' && floatingComposer ? BAR_FLOATING_PRESET : COMPOSER_PRESETS[composer];
  } else {
    if (floatingComposer) throw new Error('composer: a composer config replaces `floatingComposer`: set `fold` and `float` on it');
    config = composer;
  }
  const flags = clean(config);
  return { flags, actions: state ? stripPlan(flags, state) : [] };
}

/** The strip in a state, as today: the chevron first, then what the state offers. */
export function stripPlan(flags: ResolvedComposer, s: StripState): readonly StripPlanItem[] {
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
