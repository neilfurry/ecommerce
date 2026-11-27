import { saveBlob, toDisplayError, useEngagement, useApiClient } from '@marketplace/api-client';
import {
  Button,
  defaultRange,
  ErrorState,
  LoadingState,
  ReportFilterBar,
  type ReportFilters,
  ReportView,
  toast,
} from '@marketplace/ui';
import { useState } from 'react';

export interface ReportTab {
  name: string;
  label: string;
}

/**
 * Analytics dashboard: report tabs, date range and period, KPI cards, a trend chart and a
 * table, with CSV / Excel / PDF downloads. Every figure comes from a live API report.
 */
export function ReportsDashboard({
  scope,
  tabs,
  sellerId,
}: {
  scope: 'admin' | 'seller';
  tabs: ReportTab[];
  /** Staff: narrow the marketplace reports to one seller. */
  sellerId?: string;
}) {
  const client = useApiClient();
  const [name, setName] = useState(tabs[0]!.name);
  const [filters, setFilters] = useState<ReportFilters>(defaultRange());
  const [exporting, setExporting] = useState(false);
  const query = { ...filters, ...(sellerId ? { sellerId } : {}) };
  const report = useEngagement([scope, 'report', name, query], (e, signal) =>
    scope === 'admin' ? e.admin.report(name, query, signal) : e.seller.report(name, query, signal),
  );
  const download = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(true);
    try {
      const api = scope === 'admin' ? client.engagement.admin : client.engagement.seller;
      const blob = await api.exportReport(name, { ...query, format });
      saveBlob(blob, `${name}-${filters.from}-to-${filters.to}.${format}`);
    } catch (error) {
      toast.error(toDisplayError(error)?.message ?? 'Could not download the report.');
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reports">
        {tabs.map((t) => (
          <Button
            key={t.name}
            role="tab"
            aria-selected={t.name === name}
            variant={t.name === name ? 'default' : 'outline'}
            size="sm"
            onClick={() => setName(t.name)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <ReportFilterBar
        value={filters}
        onChange={setFilters}
        onExport={download}
        exporting={exporting}
      />
      {report.isPending ? (
        <LoadingState label="Loading the report…" />
      ) : report.error ? (
        <ErrorState
          message={toDisplayError(report.error)?.message ?? 'Could not load the report.'}
          onRetry={() => void report.refetch()}
        />
      ) : report.data ? (
        <ReportView report={report.data} />
      ) : null}
    </div>
  );
}
