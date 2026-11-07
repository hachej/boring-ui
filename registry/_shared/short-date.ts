import { createElement, type ReactElement } from 'react';

/** One short date for every card: the day and month in the browser's locale ("6 Nov", "Nov 6"), with the year added when it is not the current year, so an old date never reads as this year's. */
export function formatShortDate(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** The short date as a `<time>` whose title holds the full date and time; an invalid Date renders nothing. The text follows the browser's locale and timezone, so a server render and the browser can differ: `suppressHydrationWarning` hides the warning, not the difference, and a server-rendered host should pass its own string where a card still takes one. */
export function ShortDate({ date, className }: { date: Date; className?: string }): ReactElement | null {
  const short = formatShortDate(date);
  if (short === null) return null;
  const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(date);
  return createElement('time', { suppressHydrationWarning: true, dateTime: date.toISOString(), title: full, className }, short);
}
