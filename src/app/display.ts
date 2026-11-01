import type { KeyboardEvent } from 'react';
import { displayLocale, t } from '../domain/i18n';

export type AiState = 'running' | 'waiting' | 'queued' | 'idle';

/** An agent's state in words; a queue names how many sends wait. */
export function aiStateWords(state: AiState, pending = 0) {
  switch (state) {
    case 'running':
      return t('実行中', 'Running');
    case 'waiting':
      return t('許可待ち', 'Needs approval');
    case 'queued':
      return t(`送信待ち ${pending}`, `${pending} pending`);
    case 'idle':
      return t('待機', 'Idle');
  }
}

/**
 * A count as it fits a badge: up to `max` as written, above it `max+`. A count
 * that is not a whole number of at least zero is shown as nothing.
 */
export function countLabel(count: number, max = 99) {
  if (!Number.isFinite(count) || count < 0) return '';
  const whole = Math.floor(count);
  return whole > max ? `${max}+` : String(whole);
}

/** A time to the minute, without the year, in irori's language; a broken time is a dash. */
export function shortWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(displayLocale(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Sends on Enter; Shift+Enter breaks the line, and Enter that ends IME composition only confirms it. */
export const sendOnEnter = (send: () => void) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    send();
  }
};
