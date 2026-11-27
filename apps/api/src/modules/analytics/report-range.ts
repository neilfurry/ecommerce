import type { ReportGranularity } from '@marketplace/shared-types';

/** Philippine time has no daylight saving: a fixed UTC+8 offset. */
const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
export const DEFAULT_RANGE_DAYS = 30;
/** Most buckets a report returns (e.g. two years of days). */
export const MAX_BUCKETS = 800;

export interface ReportRange {
  /** Inclusive dates in Philippine time, YYYY-MM-DD. */
  from: string;
  to: string;
  granularity: ReportGranularity;
  /** UTC instants: [start, end). */
  start: Date;
  end: Date;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** The Manila calendar date of an instant. */
export const manilaDate = (instant: Date) => ymd(new Date(instant.getTime() + MANILA_OFFSET_MS));
/** Midnight in Manila of a YYYY-MM-DD date, as a UTC instant. */
export const manilaMidnight = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - MANILA_OFFSET_MS);

export function resolveRange(
  query: { from?: string; to?: string; granularity?: ReportGranularity },
  now = new Date(),
): ReportRange {
  const to = query.to ?? manilaDate(now);
  const from =
    query.from ?? ymd(new Date(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS));
  const granularity = query.granularity ?? 'day';
  return {
    from,
    to,
    granularity,
    start: manilaMidnight(from),
    end: new Date(manilaMidnight(to).getTime() + DAY_MS),
  };
}

/** Start of the bucket a Manila date falls in (weeks start on Monday, like date_trunc). */
export function bucketOf(date: string, granularity: ReportGranularity): string {
  const d = new Date(`${date}T00:00:00Z`);
  switch (granularity) {
    case 'day':
      return date;
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7;
      return ymd(new Date(d.getTime() - dow * DAY_MS));
    }
    case 'month':
      return `${date.slice(0, 7)}-01`;
    case 'year':
      return `${date.slice(0, 4)}-01-01`;
  }
}

/** Every bucket from the range start to its end, so periods without sales show as zero. */
export function bucketsOf(range: Pick<ReportRange, 'from' | 'to' | 'granularity'>): string[] {
  const out: string[] = [];
  let cursor = bucketOf(range.from, range.granularity);
  const last = bucketOf(range.to, range.granularity);
  while (cursor <= last && out.length < MAX_BUCKETS) {
    out.push(cursor);
    const d = new Date(`${cursor}T00:00:00Z`);
    if (range.granularity === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (range.granularity === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else if (range.granularity === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
    else d.setUTCFullYear(d.getUTCFullYear() + 1);
    cursor = ymd(d);
  }
  return out;
}

/** Display label of a bucket. */
export function labelOf(bucket: string, granularity: ReportGranularity): string {
  if (granularity === 'month') return bucket.slice(0, 7);
  if (granularity === 'year') return bucket.slice(0, 4);
  return bucket;
}

/** percent = part / whole × 100, two decimals; "0.00" when there is no whole. */
export function percent(part: number, whole: number): string {
  if (!whole) return '0.00';
  return ((part / whole) * 100).toFixed(2);
}
