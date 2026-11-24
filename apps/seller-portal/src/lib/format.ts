import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from '@marketplace/config';

const dateTime = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: DEFAULT_TIMEZONE,
});

/** Formats an ISO timestamp in Philippine time, e.g. "Nov 24, 2026, 5:39:40 PM". */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}
