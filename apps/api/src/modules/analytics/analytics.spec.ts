import type { ReportDto } from '@marketplace/validation';
import { csvCell, exportReport, exportRows, toCsv } from './report-export';
import { bucketOf, bucketsOf, manilaDate, percent, resolveRange } from './report-range';

const report: ReportDto = {
  name: 'sales',
  title: 'Sales',
  range: { from: '2026-12-01', to: '2026-12-03', granularity: 'day' },
  kpis: [{ key: 'gmv', label: 'GMV', value: '1500.00', unit: 'PHP' }],
  series: {
    keys: [{ key: 'gmv', label: 'GMV', unit: 'PHP' }],
    points: [
      { period: '2026-12-01', values: { gmv: '1000.00' } },
      { period: '2026-12-02', values: { gmv: '500.00' } },
    ],
  },
  table: {
    columns: [
      { key: 'seller', label: 'Seller', type: 'text' },
      { key: 'gmv', label: 'GMV', type: 'money' },
    ],
    rows: [
      { seller: 'Juan, "the" seller', gmv: '1000.00' },
      { seller: '=HYPERLINK("x")', gmv: '500.00' },
    ],
  },
  generatedAt: '2026-12-03T00:00:00.000Z',
};

describe('report ranges', () => {
  it('uses Philippine dates and the last 30 days by default', () => {
    // 16:30 UTC is already the next day in Manila.
    expect(manilaDate(new Date('2026-12-01T16:30:00Z'))).toBe('2026-12-02');
    const range = resolveRange({}, new Date('2026-12-01T16:30:00Z'));
    expect(range).toMatchObject({ from: '2026-11-03', to: '2026-12-02', granularity: 'day' });
    expect(range.start.toISOString()).toBe('2026-11-02T16:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-12-02T16:00:00.000Z');
  });

  it('builds day, week (Monday), month and year buckets without gaps', () => {
    expect(bucketOf('2026-12-03', 'week')).toBe('2026-11-30');
    expect(bucketsOf({ from: '2026-11-29', to: '2026-12-02', granularity: 'day' })).toHaveLength(4);
    expect(bucketsOf({ from: '2026-11-29', to: '2026-12-08', granularity: 'week' })).toEqual([
      '2026-11-23',
      '2026-11-30',
      '2026-12-07',
    ]);
    expect(bucketsOf({ from: '2026-01-15', to: '2026-03-01', granularity: 'month' })).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect(bucketsOf({ from: '2025-06-01', to: '2026-01-01', granularity: 'year' })).toEqual([
      '2025-01-01',
      '2026-01-01',
    ]);
  });

  it('computes percentages safely', () => {
    expect(percent(1, 3)).toBe('33.33');
    expect(percent(5, 0)).toBe('0.00');
  });
});

describe('report exports', () => {
  it('quotes CSV cells and neutralises spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell(null)).toBe('');
    const csv = toCsv(report);
    expect(csv.startsWith(`${String.fromCharCode(0xfeff)}Seller,GMV\r\n`)).toBe(true);
    expect(csv).toContain('"Juan, ""the"" seller",1000.00');
    expect(csv).toContain(`"'=HYPERLINK(""x"")",500.00`);
  });

  it('exports the time series when a report has no table rows', () => {
    const rows = exportRows({ ...report, table: { columns: report.table.columns, rows: [] } });
    expect(rows.headers).toEqual(['Period', 'GMV']);
    expect(rows.rows).toEqual([
      ['2026-12-01', '1000.00'],
      ['2026-12-02', '500.00'],
    ]);
  });

  it('generates real Excel and PDF files', async () => {
    const xlsx = await exportReport(report, 'xlsx');
    expect(xlsx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.fileName).toBe('sales-2026-12-01-to-2026-12-03.xlsx');
    const pdf = await exportReport(report, 'pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.contentType).toBe('application/pdf');
  });
});
