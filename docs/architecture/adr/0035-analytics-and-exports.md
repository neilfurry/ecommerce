# ADR 0035: Live analytics and report exports

- Status: Accepted
- Date: 2026-11-27

## Context

Admin and seller reports with date filters; daily, weekly, monthly and yearly periods; Excel,
CSV and PDF exports; dashboards with charts, KPI cards, tables and filters from database data.

## Decision

- Reports are live SQL over orders, payments, refunds, stock, ratings, settlements and the
  ledger; nothing is stored or estimated. Dates are Philippine time (UTC+8); periods use
  `date_trunc` (weeks start on Monday) and empty periods are filled with zeros.
- Definitions: counted seller orders are those not cancelled and not awaiting payment. GMV =
  their items subtotal; net merchandise sales = GMV − item discounts − item refunds in the
  period; platform revenue = posted credits − debits on revenue accounts (4xxx, including the
  refunds contra); commissions = order commission − refund reversals; refund rate = refunds /
  GMV; payment success = paid / (paid + failed + expired) online payments.
- One report shape (KPIs, series, table) serves the dashboard and all three exports: CSV
  (UTF-8 BOM, formula injection neutralised), XLSX (exceljs: Summary, Trend, Details sheets),
  PDF (pdfkit, first 1,000 rows). Sellers only ever see their own figures.
- Dashboards chart one measure at a time (no dual axes) with a hover tooltip and the table as
  the accessible view.
