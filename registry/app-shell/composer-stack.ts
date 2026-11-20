'use client';

// Where launchers sit when a page has several, and what the page keeps free for them. Launchers on one corner stack along the block axis (lowest `at.stack` nearest the corner, `auto` by
// mount order, 12 px apart); `avoid` rectangles push a launcher or its panel sideways along the inline axis; and the footprint of the stack is published as two CSS variables
// (`--composer-reserve-block`, `--composer-reserve-inline`) that the screens, the notice row and a host's own toasts read, instead of probing the DOM. Host concern: Pi has no layout.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { Avoid, Corner, Length } from './composer-config';
import type { LauncherOwner } from './layer-context';
export type { LauncherOwner } from './layer-context';

/** The circle's size in px (3.25 rem) and the gap between launchers on one corner. */
export const CIRCLE_SIZE = 52;
export const STACK_GAP = 12;
/** The gap kept between a launcher or panel and a rectangle it steps around. */
export const AVOID_GAP = 8;
/** The distance to a corner's edges when the config gives none. */
export const DEFAULT_OFFSET = 16;

/** A `Length` as CSS: a number is px. */
export const css = (length: Length): string => typeof length === 'number' ? `${length}px` : length;

/** One launcher of the page: `corner` is `null` for one that sits in the page's flow (a bar under the content): it keeps its `id` in the registry and takes no place on a corner. `w` and `h` are its box in px (a circle by default). */
interface Launcher { readonly key: object; readonly id: string | undefined; readonly corner: Corner | null; readonly rank: number; readonly seq: number; readonly reserve: boolean; readonly inline: string; readonly block: string; readonly w?: number; readonly h?: number }
let launchers: readonly Launcher[] = [];
const listeners = new Set<() => void>();
let counter = 0;
const EMPTY: readonly Launcher[] = [];
const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
const snapshot = () => launchers;
const serverSnapshot = () => EMPTY;

/** One composer's place in the registry: the n-th composer to mount takes n, so `auto` stacks in the order the page mounted them. The layer owns it for its whole life, whichever surface (bar, icon, circle, tab) is drawn. */
export const newLauncherOwner = (): LauncherOwner => ({ key: {}, seq: ++counter });

const before = (a: { readonly rank: number; readonly seq: number }, b: { readonly rank: number; readonly seq: number }) => a.rank !== b.rank ? a.rank < b.rank : a.seq < b.seq;
/** How many launchers on `corner` sit nearer it than the one with this rank: its place in the stack (0 is the corner's own). */
export function slotOf(all: readonly { readonly corner: Corner | null; readonly rank: number; readonly seq: number; readonly key?: object }[], mine: { readonly key?: object; readonly corner: Corner | null; readonly rank: number; readonly seq: number }): number {
  return mine.corner === null ? 0 : all.filter(other => other.corner === mine.corner && other.key !== mine.key && before(other, mine)).length;
}
const sizeH = (launcher: { readonly h?: number }) => launcher.h ?? CIRCLE_SIZE;
/** The distance in px from the corner's edge to the near side of a launcher: the height of every launcher nearer the corner, and a gap after each (boxes of different heights stack without overlap). */
export function liftOf(all: readonly Launcher[], mine: { readonly key?: object; readonly corner: Corner | null; readonly rank: number; readonly seq: number }): number {
  return mine.corner === null ? 0 : all.filter(other => other.corner === mine.corner && other.key !== mine.key && before(other, mine)).reduce((sum, other) => sum + sizeH(other) + STACK_GAP, 0);
}
/** The distance from the corner's edge to the far side of the launcher in slot `index`, as px. */
export const stackLift = (index: number): number => index * (CIRCLE_SIZE + STACK_GAP);

/** The footprint of the launchers, as the CSS the two variables take: from the window's bottom edge up to the top of the highest stack, and from the inline end edge in. */
export function reserveOf(all: readonly Launcher[]): { readonly block: string | undefined; readonly inline: string | undefined } {
  const bottoms = all.filter(launcher => launcher.reserve && launcher.corner !== null && launcher.corner.startsWith('bottom'));
  const blocks = bottoms.map(launcher => `calc(${launcher.block} + ${liftOf(all, launcher) + sizeH(launcher)}px)`);
  const inlines = bottoms.filter(launcher => launcher.corner?.endsWith('end')).map(launcher => `calc(${launcher.inline} + ${launcher.w ?? CIRCLE_SIZE}px)`);
  const join = (list: readonly string[]) => list.length === 0 ? undefined : list.length === 1 ? list[0] : `max(${list.join(', ')})`;
  return { block: join(blocks), inline: join(inlines) };
}

function publish(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { block, inline } = reserveOf(launchers);
  for (const [name, value] of [['--composer-reserve-block', block], ['--composer-reserve-inline', inline]] as const) {
    if (value === undefined) root.style.removeProperty(name); else root.style.setProperty(name, value);
  }
}
const changed = () => { publish(); for (const listener of [...listeners]) listener(); };

/** What the shell's screens keep free at their foot for the launchers: the bar's own reserve, or the launchers' footprint above the tab bar, whichever is more. `config`: the composer was given as a config object (any launcher): a string preset keeps what it always reserved. */
export const circleReserve = (bar: string, config: boolean): string => config ? `max(${bar}, max(0px, calc(var(--composer-reserve-block, 0px) - var(--app-shell-tabbar, 0px))))` : bar;

export interface LauncherSpec { readonly id: string | undefined; readonly corner: Corner | null; readonly stack: 'auto' | number; readonly reserve: boolean; readonly inline: Length; readonly block: Length; readonly w?: number; readonly h?: number }

/** Registers a launcher on its corner while `active` and returns its slot in the stack: 0 nearest the corner, and the px it lifts. Two launchers with one `id`, or one explicit `stack`, are a mistake the console names. `owner`: the layer's own, so the surface it draws can change (bar, icon, tab) without losing its place. */
export function useLauncherSlot(spec: LauncherSpec, active: boolean, owner?: LauncherOwner): { readonly slot: number; readonly lift: number; readonly first: boolean } {
  const [own] = useState<LauncherOwner>(() => owner ?? newLauncherOwner());
  const { key, seq } = owner ?? own;
  const { id, corner, stack, reserve, w, h } = spec;
  const inline = css(spec.inline), block = css(spec.block);
  const rank = typeof stack === 'number' ? stack : seq;
  useLayoutEffect(() => {
    if (!active) return;
    const mine: Launcher = { key, id, corner, rank, seq, reserve, inline, block, ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) };
    for (const other of launchers) {
      if (other.key === key) continue;
      if (id !== undefined && other.id === id) console.error(`composer: two launchers have the id "${id}": give each its own \`id\` (it names the storage keys and Ctrl+J).`);
      if (typeof stack === 'number' && corner !== null && other.corner === corner && other.rank === stack) console.error(`composer: two launchers on ${corner} share \`at.stack: ${stack}\`: give each its own, or leave it out to stack by mount order.`);
    }
    launchers = [...launchers.filter(other => other.key !== key), mine];
    changed();
    return () => { launchers = launchers.filter(other => other.key !== key); changed(); };
  }, [active, key, id, corner, stack, rank, seq, reserve, inline, block, w, h]);
  return useLauncherPlace(owner ?? own, corner, rank);
}

/** The place a registered launcher has on its corner (read only: the registrant is `useLauncherSlot`). */
export function useLauncherPlace(owner: LauncherOwner, corner: Corner | null, rank: number = owner.seq): { readonly slot: number; readonly lift: number; readonly first: boolean } {
  const all = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const { key, seq } = owner;
  const mine = all.find(other => other.key === key);
  const at = { key, corner, rank: mine?.rank ?? rank, seq };
  const first = all.every(other => other.key === key || before(at, other));
  return { slot: slotOf(all, at), lift: liftOf(all, at), first };
}

interface Box { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }

/** The inline shift, in px, that keeps a box (at its natural place on `corner`) clear of the rectangles: away from the side the corner is on, past each one it would cover. */
export function avoidShift(corner: Corner, rtl: boolean, natural: Box, rects: readonly Box[]): number {
  const right = corner.endsWith('end') !== rtl;
  let shift = 0;
  for (let pass = 0; pass <= rects.length; pass++) {
    const box = right ? { ...natural, left: natural.left - shift, right: natural.right - shift } : { ...natural, left: natural.left + shift, right: natural.right + shift };
    let moved = false;
    for (const rect of rects) {
      if (box.top >= rect.bottom + AVOID_GAP || box.bottom <= rect.top - AVOID_GAP) continue;
      if (box.left >= rect.right + AVOID_GAP || box.right <= rect.left - AVOID_GAP) continue;
      const next = right ? natural.right - rect.left + AVOID_GAP : rect.right - natural.left + AVOID_GAP;
      if (next > shift) { shift = next; moved = true; }
    }
    if (!moved) break;
  }
  return Math.max(0, Math.round(shift));
}

const boxOf = (rect: DOMRect): Box => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });

/**
 * The px an element (a launcher or its panel, drawn with the shift as extra inline offset) moves along the inline axis to keep clear of the `avoid` rectangles. It measures on mount, on a
 * resize and when the page's own boxes change, not on a clock; with nothing to avoid it measures nothing.
 */
export function useAvoidShift(ref: RefObject<HTMLElement | null>, corner: Corner, avoid: readonly Avoid[] | undefined, active: boolean): number {
  const [shift, setShift] = useState(0);
  const shiftRef = useRef(0);
  const list = useRef(avoid);
  useLayoutEffect(() => { list.current = avoid; });
  const count = avoid?.length ?? 0;
  const key = (avoid ?? []).map(entry => typeof entry === 'string' ? entry : '[fn]').join('|');
  const measure = useCallback(() => {
    const element = ref.current;
    const entries = list.current ?? [];
    if (!element || entries.length === 0) { shiftRef.current = 0; setShift(0); return; }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return;
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    const right = corner.endsWith('end') !== rtl;
    const current = shiftRef.current;
    const natural: Box = right ? { left: rect.left + current, right: rect.right + current, top: rect.top, bottom: rect.bottom } : { left: rect.left - current, right: rect.right - current, top: rect.top, bottom: rect.bottom };
    const boxes: Box[] = [];
    for (const entry of entries) {
      const found = typeof entry === 'string' ? [...document.querySelectorAll(entry)].filter(match => !element.contains(match) && !match.contains(element)).map(match => match.getBoundingClientRect()) : [entry()];
      for (const box of found) if (box && box.width > 0 && box.height > 0) boxes.push(boxOf(box));
    }
    const next = avoidShift(corner, rtl, natural, boxes);
    shiftRef.current = next;
    setShift(next);
  }, [ref, corner]);
  useEffect(() => {
    if (!active || count === 0) return;
    let frame = 0;
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('resize', later);
    const mutations = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(later);
    mutations?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'data-state'] });
    const sizes = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(later);
    sizes?.observe(document.body);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', later); mutations?.disconnect(); sizes?.disconnect(); };
  }, [active, count, key, measure]);
  // Nothing to avoid, or not on show: no shift (the last measure is kept in the ref and measured again when it is back).
  return active && count > 0 ? shift : 0;
}
