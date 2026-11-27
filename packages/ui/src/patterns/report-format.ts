import { formatMoney } from '../lib/money';

/** A report value as the API sent it, with its unit (display only). */
export function formatReportValue(value: string, unit: string): string {
  if (unit === 'PHP') return formatMoney(value);
  if (unit === '%') return `${value}%`;
  if (unit === 'stars') return `${value} ★`;
  return Number(value).toLocaleString('en-PH');
}

const ymd = (d: Date) => new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
/** The last `days` days (Philippine dates), the reports' default range. */
export function defaultRange(days = 30, now = new Date()) {
  return {
    from: ymd(new Date(now.getTime() - (days - 1) * 86_400_000)),
    to: ymd(now),
    granularity: 'day' as const,
  };
}
