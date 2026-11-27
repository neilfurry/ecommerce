import type { ReportGranularity } from '@marketplace/shared-types';
import type { ReportDto } from '@marketplace/validation';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '../components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/card';
import { Input } from '../components/input';
import { Label } from '../components/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table';
import { formatMoney } from '../lib/money';
import { formatReportValue } from './report-format';

export interface ReportFilters {
  from: string;
  to: string;
  granularity: ReportGranularity;
}

/** KPI cards from live report data. Values are shown as the API sent them. */
export function KpiCards({ kpis }: { kpis: ReportDto['kpis'] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpi-cards">
      {kpis.map((k) => (
        <div key={k.key} className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{k.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatReportValue(k.value, k.unit)}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * One measure over time (a single line, so there is never a second y-axis; switch measures
 * with the buttons). Crosshair tooltip on hover; the table below is the accessible view.
 */
export function TrendChart({ series, title }: { series: ReportDto['series']; title: string }) {
  const [key, setKey] = useState(series.keys[0]?.key ?? '');
  const active = series.keys.find((k) => k.key === key) ?? series.keys[0];
  const data = useMemo(
    () =>
      series.points.map((p) => ({
        period: p.period,
        value: Number(p.values[active?.key ?? ''] ?? 0),
      })),
    [series, active],
  );
  if (!active || series.points.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{active.label}</CardTitle>
        <CardDescription>{title}</CardDescription>
        {series.keys.length > 1 ? (
          <div className="flex flex-wrap gap-2 pt-2" role="group" aria-label="Measure">
            {series.keys.map((k) => (
              <Button
                key={k.key}
                size="sm"
                variant={k.key === active.key ? 'default' : 'outline'}
                aria-pressed={k.key === active.key}
                onClick={() => setKey(k.key)}
              >
                {k.label}
              </Button>
            ))}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full" role="img" aria-label={`${active.label} by period`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="period"
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(v: number) =>
                  active.unit === 'PHP'
                    ? `₱${Intl.NumberFormat('en-PH', { notation: 'compact' }).format(v)}`
                    : String(v)
                }
              />
              <Tooltip
                cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
                contentStyle={{
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--popover-foreground)',
                }}
                formatter={(v) => [formatReportValue(String(v), active.unit), active.label]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--chart-series-1)"
                strokeWidth={2}
                dot={data.length <= 31 ? { r: 3 } : false}
                activeDot={{ r: 5, stroke: 'var(--background)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function ReportTable({ table }: { table: ReportDto['table'] }) {
  if (table.columns.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {table.columns.map((c) => (
              <TableHead key={c.key} className={c.type === 'text' ? '' : 'text-right'}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={table.columns.length}
                className="text-center text-muted-foreground"
              >
                No data for this period.
              </TableCell>
            </TableRow>
          ) : (
            table.rows.map((row, i) => (
              <TableRow key={i}>
                {table.columns.map((c) => {
                  const v = row[c.key];
                  return (
                    <TableCell
                      key={c.key}
                      className={c.type === 'text' ? '' : 'text-right tabular-nums'}
                    >
                      {v === null || v === undefined
                        ? '—'
                        : c.type === 'money'
                          ? formatMoney(String(v))
                          : c.type === 'percent'
                            ? `${v}%`
                            : String(v)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Date range and period controls, in one row above the charts, plus exports. */
export function ReportFilterBar({
  value,
  onChange,
  onExport,
  exporting,
}: {
  value: ReportFilters;
  onChange: (next: ReportFilters) => void;
  onExport?: (format: 'csv' | 'xlsx' | 'pdf') => void;
  exporting?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="report-filters">
      <div className="grid gap-1">
        <Label htmlFor="report-from">From</Label>
        <Input
          id="report-from"
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="report-to">To</Label>
        <Input
          id="report-to"
          type="date"
          value={value.to}
          min={value.from}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="report-granularity">Period</Label>
        <select
          id="report-granularity"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={value.granularity}
          onChange={(e) => onChange({ ...value, granularity: e.target.value as ReportGranularity })}
        >
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
          <option value="year">Yearly</option>
        </select>
      </div>
      {onExport ? (
        <div className="ml-auto flex gap-2">
          {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
            <Button
              key={format}
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => onExport(format)}
            >
              <Download className="size-4" aria-hidden="true" />
              {format === 'xlsx' ? 'Excel' : format.toUpperCase()}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A whole report: KPIs, trend and table. */
export function ReportView({ report }: { report: ReportDto }) {
  return (
    <div className="grid gap-4">
      <KpiCards kpis={report.kpis} />
      <TrendChart series={report.series} title={report.title} />
      <ReportTable table={report.table} />
    </div>
  );
}
