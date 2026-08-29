import type { MouseEvent } from 'react';

/** Native tooltip only when the hovered element is actually truncated. */
export function setOverflowTitle(event: MouseEvent<HTMLElement>) {
  const el = event.currentTarget;
  const full = el.dataset.fullTitle || el.textContent?.replace(/\s+/g, ' ').trim() || '';
  el.title = el.scrollWidth > el.clientWidth ? full : '';
}
