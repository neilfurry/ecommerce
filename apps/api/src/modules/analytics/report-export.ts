import { APP_NAME } from '@marketplace/config';
import type { ReportFormat } from '@marketplace/shared-types';
import type { ReportDto } from '@marketplace/validation';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ExportedFile {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

type Cell = string | number | null;

/** A cell value as written to CSV: quoted when needed; formulas are neutralised. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Spreadsheet formula injection: a leading =, +, - or @ in text is prefixed with '.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text))
    text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The rows exported: the report table, or the time series when the report has no table. */
export function exportRows(report: ReportDto): {
  headers: string[];
  keys: string[];
  rows: Cell[][];
} {
  if (report.table.rows.length > 0 || report.series.keys.length === 0) {
    const keys = report.table.columns.map((c) => c.key);
    return {
      headers: report.table.columns.map((c) => c.label),
      keys,
      rows: report.table.rows.map((r) => keys.map((k) => r[k] ?? null)),
    };
  }
  const keys = ['period', ...report.series.keys.map((k) => k.key)];
  return {
    headers: ['Period', ...report.series.keys.map((k) => k.label)],
    keys,
    rows: report.series.points.map((p) => [
      p.period,
      ...report.series.keys.map((k) => p.values[k.key] ?? null),
    ]),
  };
}

export function toCsv(report: ReportDto): string {
  const { headers, rows } = exportRows(report);
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
  // A BOM so Excel opens UTF-8 (₱, ñ) correctly.
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`;
}

const numeric = (type: string) => type === 'money' || type === 'number' || type === 'percent';

export async function toXlsx(report: ReportDto): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = APP_NAME;
  book.created = new Date(report.generatedAt);
  const summary = book.addWorksheet('Summary');
  summary.addRow([report.title]).font = { bold: true, size: 14 };
  summary.addRow([`${report.range.from} to ${report.range.to} (${report.range.granularity})`]);
  summary.addRow([]);
  summary.addRow(['Measure', 'Value', 'Unit']).font = { bold: true };
  for (const k of report.kpis) summary.addRow([k.label, Number(k.value), k.unit]);
  summary.columns = [{ width: 32 }, { width: 18 }, { width: 10 }];
  if (report.series.keys.length > 0) {
    const trend = book.addWorksheet('Trend');
    trend.addRow(['Period', ...report.series.keys.map((k) => k.label)]).font = { bold: true };
    for (const p of report.series.points)
      trend.addRow([p.period, ...report.series.keys.map((k) => Number(p.values[k.key] ?? 0))]);
    trend.columns = [{ width: 14 }, ...report.series.keys.map(() => ({ width: 18 }))];
  }
  const details = book.addWorksheet('Details');
  details.addRow(report.table.columns.map((c) => c.label)).font = { bold: true };
  for (const row of report.table.rows) {
    details.addRow(
      report.table.columns.map((c) => {
        const v = row[c.key];
        return v !== null && v !== undefined && numeric(c.type) ? Number(v) : (v ?? null);
      }),
    );
  }
  report.table.columns.forEach((c, i) => {
    const column = details.getColumn(i + 1);
    column.width = c.type === 'text' ? 28 : 16;
    if (c.type === 'money') column.numFmt = '#,##0.00';
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function toPdf(report: ReportDto): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    // The standard PDF fonts have no peso sign: amounts are labelled PHP.
    const text = (v: unknown) => String(v ?? '').replace(/₱/g, 'PHP ');
    doc.fontSize(16).text(`${APP_NAME} - ${text(report.title)}`);
    doc
      .fontSize(10)
      .fillColor('#475569')
      .text(
        `${report.range.from} to ${report.range.to} (${report.range.granularity}); generated ${report.generatedAt}`,
      );
    doc.moveDown().fillColor('#0f172a');
    for (const k of report.kpis)
      doc.fontSize(10).text(`${text(k.label)}: ${k.value} ${k.unit === '%' ? '%' : k.unit}`);
    doc.moveDown();
    const { headers, rows } = exportRows(report);
    const width = doc.page.width - 80;
    const colWidth = width / Math.max(1, headers.length);
    const drawRow = (cells: Cell[], bold: boolean) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      cells.forEach((c, i) =>
        doc.text(text(c), 40 + i * colWidth, y, {
          width: colWidth - 4,
          ellipsis: true,
          lineBreak: false,
        }),
      );
      doc.moveDown(0.6);
      doc.x = 40;
    };
    drawRow(headers, true);
    for (const row of rows.slice(0, 1000)) drawRow(row, false);
    if (rows.length > 1000)
      doc.text(`… ${rows.length - 1000} more rows in the CSV or Excel export.`);
    doc.end();
  });
}

export async function exportReport(report: ReportDto, format: ReportFormat): Promise<ExportedFile> {
  const base = `${report.name}-${report.range.from}-to-${report.range.to}`;
  if (format === 'xlsx')
    return {
      buffer: await toXlsx(report),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `${base}.xlsx`,
    };
  if (format === 'pdf')
    return { buffer: await toPdf(report), contentType: 'application/pdf', fileName: `${base}.pdf` };
  return {
    buffer: Buffer.from(toCsv(report), 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    fileName: `${base}.csv`,
  };
}
