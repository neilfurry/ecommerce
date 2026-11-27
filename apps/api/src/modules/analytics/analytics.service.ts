import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@marketplace/database';
import type { ReportGranularity } from '@marketplace/shared-types';
import type {
  AdminReportName,
  ReportDto,
  ReportQueryParsed,
  SellerReportName,
} from '@marketplace/validation';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { bucketsOf, labelOf, percent, type ReportRange, resolveRange } from './report-range';

type Num = Prisma.Decimal | number | string | bigint | null | undefined;
const n = (v: Num) => (v === null || v === undefined ? 0 : Number(v));
const m = (v: Num) => n(v).toFixed(2);
type Column = ReportDto['table']['columns'][number];
type Row = ReportDto['table']['rows'][number];

/** Seller orders that count as sales: placed (paid or cash on delivery) and not cancelled. */
const COUNTED = Prisma.sql`so."status" NOT IN ('CANCELLED', 'AWAITING_PAYMENT')`;

const GRANULARITY: Record<ReportGranularity, Prisma.Sql> = {
  day: Prisma.raw(`'day'`),
  week: Prisma.raw(`'week'`),
  month: Prisma.raw(`'month'`),
  year: Prisma.raw(`'year'`),
};
const bucket = (column: Prisma.Sql, g: ReportGranularity) =>
  Prisma.sql`to_char(date_trunc(${GRANULARITY[g]}, (${column} AT TIME ZONE 'Asia/Manila')), 'YYYY-MM-DD')`;

interface Series {
  keys: { key: string; label: string; unit: string }[];
  rows: Map<string, Record<string, string>>;
}

/**
 * Analytics (ADR 0035): every figure is a live query over orders, payments, refunds, the
 * ledger, stock and ratings: nothing is stored or estimated. Dates are Philippine time;
 * periods are day, week (Monday), month or year, with empty periods shown as zero.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private series(
    range: ReportRange,
    keys: Series['keys'],
    data: { period: string; [k: string]: Num }[],
  ) {
    const byPeriod = new Map(data.map((d) => [d.period, d]));
    return {
      keys,
      points: bucketsOf(range).map((period) => ({
        period: labelOf(period, range.granularity),
        values: Object.fromEntries(
          keys.map((k) => {
            const raw = byPeriod.get(period)?.[k.key];
            return [k.key, k.unit === 'PHP' ? m(raw) : String(n(raw))];
          }),
        ),
      })),
    };
  }

  private report(
    name: string,
    title: string,
    range: ReportRange,
    kpis: ReportDto['kpis'],
    series: ReportDto['series'],
    columns: Column[],
    rows: Row[],
  ): ReportDto {
    return {
      name,
      title,
      range: { from: range.from, to: range.to, granularity: range.granularity },
      kpis,
      series,
      table: { columns, rows },
      generatedAt: new Date().toISOString(),
    };
  }

  async admin(name: AdminReportName, query: ReportQueryParsed): Promise<ReportDto> {
    const range = resolveRange(query);
    switch (name) {
      case 'sales':
        return this.sales(range, query.sellerId ?? null, 'admin');
      case 'products':
        return this.products(range, query.sellerId ?? null);
      case 'categories':
        return this.categories(range);
      case 'sellers':
        return this.sellers(range);
      case 'customers':
        return this.customers(range);
      case 'payments':
        return this.payments(range);
      case 'refunds':
        return this.refunds(range, query.sellerId ?? null);
      default:
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Report not found.');
    }
  }

  async seller(
    sellerId: string,
    name: SellerReportName,
    query: ReportQueryParsed,
  ): Promise<ReportDto> {
    const range = resolveRange(query);
    switch (name) {
      case 'sales':
        return this.sales(range, sellerId, 'seller');
      case 'products':
        return this.products(range, sellerId);
      case 'inventory':
        return this.inventory(range, sellerId);
      case 'ratings':
        return this.ratings(range, sellerId);
      case 'commissions':
        return this.commissions(range, sellerId);
      case 'settlements':
        return this.settlements(range, sellerId);
      default:
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Report not found.');
    }
  }

  // ---- Sales ----------------------------------------------------------------------------------

  /**
   * GMV: merchandise value of counted seller orders (after wholesale and flash prices, before
   * discounts). Net merchandise sales: GMV less item discounts and item refunds. Platform
   * revenue: the ledger's revenue accounts (commission, fee recoveries, shipping, charges, less
   * refunds contra), as posted. Sellers see their own figures, with seller-paid discounts only.
   */
  private async sales(range: ReportRange, sellerId: string | null, view: 'admin' | 'seller') {
    const g = range.granularity;
    const seller = sellerId ? Prisma.sql`AND so."seller_id" = ${sellerId}::uuid` : Prisma.empty;
    const discount =
      view === 'seller'
        ? Prisma.sql`so."seller_discount"`
        : Prisma.sql`so."seller_discount" + so."platform_discount"`;
    const orders = await this.prisma.$queryRaw<
      {
        period: string;
        gmv: Num;
        discounts: Num;
        commission: Num;
        orders: number;
        customers: number;
      }[]
    >`
      SELECT ${bucket(Prisma.sql`o."placed_at"`, g)} AS "period",
        SUM(so."items_subtotal") AS "gmv",
        SUM(${discount}) AS "discounts",
        SUM(so."commission_amount") AS "commission",
        COUNT(DISTINCT so."order_id")::int AS "orders",
        COUNT(DISTINCT o."customer_id")::int AS "customers"
      FROM "seller_orders" so JOIN "orders" o ON o."id" = so."order_id"
      WHERE ${COUNTED} ${seller} AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      GROUP BY 1`;
    const refunds = await this.prisma.$queryRaw<
      { period: string; items: Num; reversal: Num; count: number }[]
    >`
      SELECT ${bucket(Prisma.sql`r."succeeded_at"`, g)} AS "period",
        SUM(r."items_amount") AS "items", SUM(r."commission_reversal") AS "reversal", COUNT(*)::int AS "count"
      FROM "refunds" r LEFT JOIN "seller_orders" so ON so."id" = r."seller_order_id"
      WHERE r."status" = 'SUCCEEDED' AND r."succeeded_at" >= ${range.start} AND r."succeeded_at" < ${range.end}
        ${sellerId ? Prisma.sql`AND so."seller_id" = ${sellerId}::uuid` : Prisma.empty}
      GROUP BY 1`;
    const revenue =
      view === 'admin'
        ? await this.prisma.$queryRaw<{ period: string; revenue: Num }[]>`
            SELECT ${bucket(Prisma.sql`t."occurred_at"`, g)} AS "period", SUM(e."credit" - e."debit") AS "revenue"
            FROM "journal_entries" e
            JOIN "journal_transactions" t ON t."id" = e."transaction_id"
            JOIN "ledger_accounts" a ON a."id" = e."account_id"
            WHERE t."status" = 'POSTED' AND a."type" = 'REVENUE'
              AND t."occurred_at" >= ${range.start} AND t."occurred_at" < ${range.end}
              ${sellerId ? Prisma.sql`AND e."seller_id" = ${sellerId}::uuid` : Prisma.empty}
            GROUP BY 1`
        : [];
    const payments = view === 'admin' ? await this.paymentTotals(range) : { attempts: 0, paid: 0 };
    const periods = new Set([...orders.map((o) => o.period), ...refunds.map((r) => r.period)]);
    const data = [...periods].map((period) => {
      const o = orders.find((x) => x.period === period);
      const r = refunds.find((x) => x.period === period);
      const rev = revenue.find((x) => x.period === period);
      return {
        period,
        gmv: n(o?.gmv),
        net: n(o?.gmv) - n(o?.discounts) - n(r?.items),
        commission: n(o?.commission) - n(r?.reversal),
        revenue: n(rev?.revenue),
        refunds: n(r?.items),
        orders: o?.orders ?? 0,
      };
    });
    const total = (k: keyof (typeof data)[number]) =>
      data.reduce((s, d) => s + (k === 'period' ? 0 : (d[k] as number)), 0);
    const [distinct] = await this.prisma.$queryRaw<{ customers: number; orders: number }[]>`
      SELECT COUNT(DISTINCT o."customer_id")::int AS "customers", COUNT(DISTINCT so."order_id")::int AS "orders"
      FROM "seller_orders" so JOIN "orders" o ON o."id" = so."order_id"
      WHERE ${COUNTED} ${seller} AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}`;
    const gmv = total('gmv');
    const orderCount = distinct?.orders ?? 0;
    const kpis: ReportDto['kpis'] = [
      { key: 'gmv', label: view === 'admin' ? 'GMV' : 'Gross sales', value: m(gmv), unit: 'PHP' },
      { key: 'net', label: 'Net merchandise sales', value: m(total('net')), unit: 'PHP' },
      ...(view === 'admin'
        ? [{ key: 'revenue', label: 'Platform revenue', value: m(total('revenue')), unit: 'PHP' }]
        : []),
      {
        key: 'commission',
        label: view === 'admin' ? 'Commissions' : 'Commission deductions',
        value: m(total('commission')),
        unit: 'PHP',
      },
      { key: 'orders', label: 'Orders', value: String(orderCount), unit: 'count' },
      {
        key: 'aov',
        label: 'Average order value',
        value: m(orderCount ? gmv / orderCount : 0),
        unit: 'PHP',
      },
      {
        key: 'customers',
        label: 'Customers',
        value: String(distinct?.customers ?? 0),
        unit: 'count',
      },
      { key: 'refundRate', label: 'Refund rate', value: percent(total('refunds'), gmv), unit: '%' },
      ...(view === 'admin'
        ? [
            {
              key: 'paymentSuccess',
              label: 'Payment success rate',
              value: percent(payments.paid, payments.attempts),
              unit: '%',
            },
          ]
        : []),
    ];
    const keys = [
      { key: 'gmv', label: view === 'admin' ? 'GMV' : 'Gross sales', unit: 'PHP' },
      { key: 'net', label: 'Net sales', unit: 'PHP' },
      ...(view === 'admin' ? [{ key: 'revenue', label: 'Platform revenue', unit: 'PHP' }] : []),
      { key: 'commission', label: 'Commission', unit: 'PHP' },
      { key: 'orders', label: 'Orders', unit: 'count' },
    ];
    const series = this.series(range, keys, data);
    const columns: Column[] = [
      { key: 'period', label: 'Period', type: 'text' },
      ...keys.map((k) => ({
        key: k.key,
        label: k.label,
        type: (k.unit === 'PHP' ? 'money' : 'number') as Column['type'],
      })),
    ];
    const rows = series.points.map((p) => ({ period: p.period, ...p.values }));
    return this.report(
      'sales',
      view === 'admin' ? 'Sales' : 'My sales',
      range,
      kpis,
      series,
      columns,
      rows,
    );
  }

  private async paymentTotals(range: ReportRange) {
    const [row] = await this.prisma.$queryRaw<{ attempts: number; paid: number }[]>`
      SELECT COUNT(*) FILTER (WHERE "status" IN ('PAID', 'FAILED', 'EXPIRED'))::int AS "attempts",
        COUNT(*) FILTER (WHERE "status" = 'PAID')::int AS "paid"
      FROM "payments" WHERE "method" <> 'COD' AND "created_at" >= ${range.start} AND "created_at" < ${range.end}`;
    return { attempts: row?.attempts ?? 0, paid: row?.paid ?? 0 };
  }

  // ---- Products and categories ------------------------------------------------------------

  private async products(range: ReportRange, sellerId: string | null) {
    const seller = sellerId ? Prisma.sql`AND so."seller_id" = ${sellerId}::uuid` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      {
        product_id: string;
        name: string;
        store: string;
        units: number;
        gross: Num;
        net: Num;
        orders: number;
        rating: Num;
        reviews: number;
      }[]
    >`
      SELECT i."product_id", p."name", st."name" AS "store",
        SUM(i."quantity")::int AS "units", SUM(i."line_subtotal") AS "gross", SUM(i."line_total") AS "net",
        COUNT(DISTINCT i."order_id")::int AS "orders", p."rating_average" AS "rating", p."rating_count" AS "reviews"
      FROM "order_items" i
      JOIN "seller_orders" so ON so."id" = i."seller_order_id"
      JOIN "orders" o ON o."id" = i."order_id"
      JOIN "products" p ON p."id" = i."product_id"
      JOIN "stores" st ON st."id" = so."store_id"
      WHERE ${COUNTED} ${seller} AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      GROUP BY i."product_id", p."name", st."name", p."rating_average", p."rating_count"
      ORDER BY "gross" DESC LIMIT 100`;
    const series = await this.prisma.$queryRaw<
      { period: string; units: number; products: number }[]
    >`
      SELECT ${bucket(Prisma.sql`o."placed_at"`, range.granularity)} AS "period",
        SUM(i."quantity")::int AS "units", COUNT(DISTINCT i."product_id")::int AS "products"
      FROM "order_items" i JOIN "seller_orders" so ON so."id" = i."seller_order_id" JOIN "orders" o ON o."id" = i."order_id"
      WHERE ${COUNTED} ${seller} AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      GROUP BY 1`;
    const units = series.reduce((s, r) => s + r.units, 0);
    return this.report(
      'products',
      'Product performance',
      range,
      [
        { key: 'products', label: 'Products sold', value: String(rows.length), unit: 'count' },
        { key: 'units', label: 'Units sold', value: String(units), unit: 'count' },
        {
          key: 'gross',
          label: 'Gross sales (top 100)',
          value: m(rows.reduce((s, r) => s + n(r.gross), 0)),
          unit: 'PHP',
        },
      ],
      this.series(
        range,
        [
          { key: 'units', label: 'Units sold', unit: 'count' },
          { key: 'products', label: 'Products sold', unit: 'count' },
        ],
        series,
      ),
      [
        { key: 'product', label: 'Product', type: 'text' },
        { key: 'store', label: 'Store', type: 'text' },
        { key: 'units', label: 'Units', type: 'number' },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'gross', label: 'Gross sales', type: 'money' },
        { key: 'net', label: 'Net sales', type: 'money' },
        { key: 'rating', label: 'Rating', type: 'number' },
      ],
      rows.map((r) => ({
        product: r.name,
        store: r.store,
        units: r.units,
        orders: r.orders,
        gross: m(r.gross),
        net: m(r.net),
        rating: n(r.rating).toFixed(2),
      })),
    );
  }

  private async categories(range: ReportRange) {
    const rows = await this.prisma.$queryRaw<
      { name: string; units: number; gross: Num; net: Num; products: number; orders: number }[]
    >`
      SELECT c."name", SUM(i."quantity")::int AS "units", SUM(i."line_subtotal") AS "gross",
        SUM(i."line_total") AS "net", COUNT(DISTINCT i."product_id")::int AS "products",
        COUNT(DISTINCT i."order_id")::int AS "orders"
      FROM "order_items" i
      JOIN "seller_orders" so ON so."id" = i."seller_order_id"
      JOIN "orders" o ON o."id" = i."order_id"
      JOIN "products" p ON p."id" = i."product_id"
      JOIN "categories" c ON c."id" = p."category_id"
      WHERE ${COUNTED} AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      GROUP BY c."name" ORDER BY "gross" DESC`;
    const gross = rows.reduce((s, r) => s + n(r.gross), 0);
    return this.report(
      'categories',
      'Category performance',
      range,
      [
        {
          key: 'categories',
          label: 'Categories with sales',
          value: String(rows.length),
          unit: 'count',
        },
        { key: 'gross', label: 'Gross sales', value: m(gross), unit: 'PHP' },
        {
          key: 'top',
          label: 'Top category share',
          value: percent(n(rows[0]?.gross), gross),
          unit: '%',
        },
      ],
      { keys: [], points: [] },
      [
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'products', label: 'Products', type: 'number' },
        { key: 'units', label: 'Units', type: 'number' },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'gross', label: 'Gross sales', type: 'money' },
        { key: 'net', label: 'Net sales', type: 'money' },
        { key: 'share', label: 'Share', type: 'percent' },
      ],
      rows.map((r) => ({
        category: r.name,
        products: r.products,
        units: r.units,
        orders: r.orders,
        gross: m(r.gross),
        net: m(r.net),
        share: percent(n(r.gross), gross),
      })),
    );
  }

  // ---- Sellers and customers -----------------------------------------------------------------

  private async sellers(range: ReportRange) {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        orders: number;
        gmv: Num;
        net: Num;
        commission: Num;
        refunds: Num;
        rating: Num;
        ratings: number;
      }[]
    >`
      SELECT s."id", s."business_name" AS "name",
        COUNT(*)::int AS "orders", SUM(so."items_subtotal") AS "gmv",
        SUM(so."items_subtotal" - so."seller_discount" - so."platform_discount") AS "net",
        SUM(so."commission_amount") AS "commission",
        (SELECT SUM(r."items_amount") FROM "refunds" r JOIN "seller_orders" x ON x."id" = r."seller_order_id"
          WHERE x."seller_id" = s."id" AND r."status" = 'SUCCEEDED'
            AND r."succeeded_at" >= ${range.start} AND r."succeeded_at" < ${range.end}) AS "refunds",
        (SELECT round(avg(sr."overall"), 2) FROM "seller_ratings" sr WHERE sr."seller_id" = s."id") AS "rating",
        (SELECT COUNT(*)::int FROM "seller_ratings" sr WHERE sr."seller_id" = s."id") AS "ratings"
      FROM "seller_orders" so JOIN "orders" o ON o."id" = so."order_id" JOIN "sellers" s ON s."id" = so."seller_id"
      WHERE ${COUNTED} AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      GROUP BY s."id", s."business_name" ORDER BY "gmv" DESC LIMIT 200`;
    const [counts] = await this.prisma.$queryRaw<
      { active: number; verified: number; new: number }[]
    >`
      SELECT
        (SELECT COUNT(DISTINCT so."seller_id")::int FROM "seller_orders" so JOIN "orders" o ON o."id" = so."order_id"
          WHERE ${COUNTED} AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}) AS "active",
        (SELECT COUNT(*)::int FROM "sellers" WHERE "status" = 'VERIFIED') AS "verified",
        (SELECT COUNT(*)::int FROM "sellers" WHERE "created_at" >= ${range.start} AND "created_at" < ${range.end}) AS "new"`;
    return this.report(
      'sellers',
      'Seller performance',
      range,
      [
        {
          key: 'active',
          label: 'Sellers with sales',
          value: String(counts?.active ?? 0),
          unit: 'count',
        },
        {
          key: 'verified',
          label: 'Verified sellers',
          value: String(counts?.verified ?? 0),
          unit: 'count',
        },
        { key: 'new', label: 'New sellers', value: String(counts?.new ?? 0), unit: 'count' },
      ],
      { keys: [], points: [] },
      [
        { key: 'seller', label: 'Seller', type: 'text' },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'gmv', label: 'GMV', type: 'money' },
        { key: 'net', label: 'Net sales', type: 'money' },
        { key: 'commission', label: 'Commission', type: 'money' },
        { key: 'refunds', label: 'Refunds', type: 'money' },
        { key: 'refundRate', label: 'Refund rate', type: 'percent' },
        { key: 'rating', label: 'Seller rating', type: 'number' },
      ],
      rows.map((r) => ({
        seller: r.name,
        orders: r.orders,
        gmv: m(r.gmv),
        net: m(r.net),
        commission: m(r.commission),
        refunds: m(r.refunds),
        refundRate: percent(n(r.refunds), n(r.gmv)),
        rating: r.ratings > 0 ? n(r.rating).toFixed(2) : null,
      })),
    );
  }

  private async customers(range: ReportRange) {
    const g = range.granularity;
    const signups = await this.prisma.$queryRaw<{ period: string; new: number }[]>`
      SELECT ${bucket(Prisma.sql`u."created_at"`, g)} AS "period", COUNT(*)::int AS "new"
      FROM "users" u JOIN "user_roles" ur ON ur."user_id" = u."id" AND ur."role_code" IN ('CUSTOMER', 'WHOLESALE_CUSTOMER')
      WHERE u."created_at" >= ${range.start} AND u."created_at" < ${range.end}
      GROUP BY 1`;
    const buyers = await this.prisma.$queryRaw<{ period: string; buyers: number }[]>`
      SELECT ${bucket(Prisma.sql`o."placed_at"`, g)} AS "period", COUNT(DISTINCT o."customer_id")::int AS "buyers"
      FROM "orders" o WHERE o."status" NOT IN ('CANCELLED', 'AWAITING_PAYMENT')
        AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      GROUP BY 1`;
    const top = await this.prisma.$queryRaw<
      { name: string; email: string; orders: number; spend: Num; first: Date }[]
    >`
      SELECT u."first_name" || ' ' || u."last_name" AS "name", u."email",
        COUNT(*)::int AS "orders", SUM(o."grand_total") AS "spend", MIN(o."placed_at") AS "first"
      FROM "orders" o JOIN "users" u ON u."id" = o."customer_id"
      WHERE o."status" NOT IN ('CANCELLED', 'AWAITING_PAYMENT')
        AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      GROUP BY u."id" ORDER BY "spend" DESC LIMIT 50`;
    const [totals] = await this.prisma.$queryRaw<{ buyers: number; repeat: number }[]>`
      SELECT COUNT(*)::int AS "buyers", COUNT(*) FILTER (WHERE "orders" > 1)::int AS "repeat" FROM (
        SELECT o."customer_id", COUNT(*) AS "orders" FROM "orders" o
        WHERE o."status" NOT IN ('CANCELLED', 'AWAITING_PAYMENT')
          AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
        GROUP BY 1) x`;
    const data = [
      ...new Set([...signups.map((s) => s.period), ...buyers.map((b) => b.period)]),
    ].map((period) => ({
      period,
      new: signups.find((s) => s.period === period)?.new ?? 0,
      buyers: buyers.find((b) => b.period === period)?.buyers ?? 0,
    }));
    return this.report(
      'customers',
      'Customers',
      range,
      [
        {
          key: 'new',
          label: 'New customers',
          value: String(signups.reduce((s, r) => s + r.new, 0)),
          unit: 'count',
        },
        {
          key: 'buyers',
          label: 'Customers who ordered',
          value: String(totals?.buyers ?? 0),
          unit: 'count',
        },
        {
          key: 'repeat',
          label: 'Repeat customers',
          value: percent(totals?.repeat ?? 0, totals?.buyers ?? 0),
          unit: '%',
        },
      ],
      this.series(
        range,
        [
          { key: 'new', label: 'New customers', unit: 'count' },
          { key: 'buyers', label: 'Customers who ordered', unit: 'count' },
        ],
        data,
      ),
      [
        { key: 'customer', label: 'Customer', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'spend', label: 'Spend', type: 'money' },
        { key: 'first', label: 'First order in range', type: 'text' },
      ],
      top.map((t) => ({
        customer: t.name,
        email: t.email,
        orders: t.orders,
        spend: m(t.spend),
        first: t.first.toISOString().slice(0, 10),
      })),
    );
  }

  // ---- Payments and refunds -----------------------------------------------------------------

  private async payments(range: ReportRange) {
    const series = await this.prisma.$queryRaw<
      { period: string; paid: number; failed: number; amount: Num }[]
    >`
      SELECT ${bucket(Prisma.sql`"created_at"`, range.granularity)} AS "period",
        COUNT(*) FILTER (WHERE "status" = 'PAID')::int AS "paid",
        COUNT(*) FILTER (WHERE "status" IN ('FAILED', 'EXPIRED'))::int AS "failed",
        SUM("amount_received") FILTER (WHERE "status" = 'PAID') AS "amount"
      FROM "payments" WHERE "method" <> 'COD' AND "created_at" >= ${range.start} AND "created_at" < ${range.end}
      GROUP BY 1`;
    const methods = await this.prisma.$queryRaw<
      { method: string; attempts: number; paid: number; failed: number; amount: Num }[]
    >`
      SELECT "method"::text, COUNT(*)::int AS "attempts",
        COUNT(*) FILTER (WHERE "status" = 'PAID')::int AS "paid",
        COUNT(*) FILTER (WHERE "status" IN ('FAILED', 'EXPIRED'))::int AS "failed",
        SUM("amount_received") FILTER (WHERE "status" = 'PAID') AS "amount"
      FROM "payments" WHERE "created_at" >= ${range.start} AND "created_at" < ${range.end}
      GROUP BY 1 ORDER BY 2 DESC`;
    const totals = await this.paymentTotals(range);
    return this.report(
      'payments',
      'Payments',
      range,
      [
        {
          key: 'success',
          label: 'Online payment success rate',
          value: percent(totals.paid, totals.attempts),
          unit: '%',
        },
        { key: 'paid', label: 'Paid online payments', value: String(totals.paid), unit: 'count' },
        {
          key: 'amount',
          label: 'Received online',
          value: m(series.reduce((s, r) => s + n(r.amount), 0)),
          unit: 'PHP',
        },
      ],
      this.series(
        range,
        [
          { key: 'paid', label: 'Paid', unit: 'count' },
          { key: 'failed', label: 'Failed or expired', unit: 'count' },
        ],
        series,
      ),
      [
        { key: 'method', label: 'Method', type: 'text' },
        { key: 'attempts', label: 'Attempts', type: 'number' },
        { key: 'paid', label: 'Paid', type: 'number' },
        { key: 'failed', label: 'Failed or expired', type: 'number' },
        { key: 'success', label: 'Success rate', type: 'percent' },
        { key: 'amount', label: 'Received', type: 'money' },
      ],
      methods.map((r) => ({
        method: r.method,
        attempts: r.attempts,
        paid: r.paid,
        failed: r.failed,
        success: percent(r.paid, r.paid + r.failed),
        amount: m(r.amount),
      })),
    );
  }

  private async refunds(range: ReportRange, sellerId: string | null) {
    const seller = sellerId ? Prisma.sql`AND so."seller_id" = ${sellerId}::uuid` : Prisma.empty;
    const series = await this.prisma.$queryRaw<{ period: string; count: number; amount: Num }[]>`
      SELECT ${bucket(Prisma.sql`r."succeeded_at"`, range.granularity)} AS "period",
        COUNT(*)::int AS "count", SUM(r."amount") AS "amount"
      FROM "refunds" r LEFT JOIN "seller_orders" so ON so."id" = r."seller_order_id"
      WHERE r."status" = 'SUCCEEDED' AND r."succeeded_at" >= ${range.start} AND r."succeeded_at" < ${range.end} ${seller}
      GROUP BY 1`;
    const reasons = await this.prisma.$queryRaw<{ reason: string; count: number; amount: Num }[]>`
      SELECT r."reason"::text, COUNT(*)::int AS "count", SUM(r."amount") AS "amount"
      FROM "refunds" r LEFT JOIN "seller_orders" so ON so."id" = r."seller_order_id"
      WHERE r."status" = 'SUCCEEDED' AND r."succeeded_at" >= ${range.start} AND r."succeeded_at" < ${range.end} ${seller}
      GROUP BY 1 ORDER BY 3 DESC`;
    const [base] = await this.prisma.$queryRaw<{ orders: number; refunded: number; gmv: Num }[]>`
      SELECT COUNT(*)::int AS "orders", SUM(so."items_subtotal") AS "gmv",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "refunds" r WHERE r."seller_order_id" = so."id" AND r."status" = 'SUCCEEDED'))::int AS "refunded"
      FROM "seller_orders" so JOIN "orders" o ON o."id" = so."order_id"
      WHERE ${COUNTED} ${seller} AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}`;
    const amount = series.reduce((s, r) => s + n(r.amount), 0);
    return this.report(
      'refunds',
      'Refunds',
      range,
      [
        { key: 'amount', label: 'Refunded', value: m(amount), unit: 'PHP' },
        {
          key: 'count',
          label: 'Refunds',
          value: String(series.reduce((s, r) => s + r.count, 0)),
          unit: 'count',
        },
        {
          key: 'rate',
          label: 'Orders with a refund',
          value: percent(base?.refunded ?? 0, base?.orders ?? 0),
          unit: '%',
        },
        { key: 'share', label: 'Refunds / GMV', value: percent(amount, n(base?.gmv)), unit: '%' },
      ],
      this.series(
        range,
        [
          { key: 'amount', label: 'Refunded', unit: 'PHP' },
          { key: 'count', label: 'Refunds', unit: 'count' },
        ],
        series,
      ),
      [
        { key: 'reason', label: 'Reason', type: 'text' },
        { key: 'count', label: 'Refunds', type: 'number' },
        { key: 'amount', label: 'Amount', type: 'money' },
      ],
      reasons.map((r) => ({ reason: r.reason, count: r.count, amount: m(r.amount) })),
    );
  }

  // ---- Seller-only reports --------------------------------------------------------------------

  private async inventory(range: ReportRange, sellerId: string) {
    const rows = await this.prisma.$queryRaw<
      {
        product: string;
        variant: string;
        sku: string;
        warehouse: string;
        on_hand: number;
        reserved: number;
        threshold: number | null;
      }[]
    >`
      SELECT p."name" AS "product", v."title" AS "variant", v."sku", w."name" AS "warehouse",
        s."quantity_on_hand" AS "on_hand", s."reserved_quantity" AS "reserved", s."low_stock_threshold" AS "threshold"
      FROM "stock_levels" s
      JOIN "product_variants" v ON v."id" = s."variant_id"
      JOIN "products" p ON p."id" = v."product_id"
      JOIN "warehouses" w ON w."id" = s."warehouse_id"
      WHERE s."seller_id" = ${sellerId}::uuid
      ORDER BY (s."quantity_on_hand" - s."reserved_quantity") ASC, p."name" LIMIT 500`;
    const movements = await this.prisma.$queryRaw<{ period: string; in: number; out: number }[]>`
      SELECT ${bucket(Prisma.sql`"created_at"`, range.granularity)} AS "period",
        SUM(GREATEST("quantity_change", 0))::int AS "in", SUM(GREATEST(-"quantity_change", 0))::int AS "out"
      FROM "inventory_movements" WHERE "seller_id" = ${sellerId}::uuid
        AND "created_at" >= ${range.start} AND "created_at" < ${range.end}
      GROUP BY 1`;
    const available = (r: (typeof rows)[number]) => r.on_hand - r.reserved;
    return this.report(
      'inventory',
      'Inventory',
      range,
      [
        { key: 'skus', label: 'Stock levels', value: String(rows.length), unit: 'count' },
        {
          key: 'units',
          label: 'Units on hand',
          value: String(rows.reduce((s, r) => s + r.on_hand, 0)),
          unit: 'count',
        },
        {
          key: 'low',
          label: 'Low stock',
          value: String(
            rows.filter(
              (r) => r.threshold !== null && available(r) <= r.threshold && available(r) > 0,
            ).length,
          ),
          unit: 'count',
        },
        {
          key: 'out',
          label: 'Out of stock',
          value: String(rows.filter((r) => available(r) <= 0).length),
          unit: 'count',
        },
      ],
      this.series(
        range,
        [
          { key: 'in', label: 'Units in', unit: 'count' },
          { key: 'out', label: 'Units out', unit: 'count' },
        ],
        movements,
      ),
      [
        { key: 'product', label: 'Product', type: 'text' },
        { key: 'variant', label: 'Variant', type: 'text' },
        { key: 'sku', label: 'SKU', type: 'text' },
        { key: 'warehouse', label: 'Warehouse', type: 'text' },
        { key: 'onHand', label: 'On hand', type: 'number' },
        { key: 'reserved', label: 'Reserved', type: 'number' },
        { key: 'available', label: 'Available', type: 'number' },
        { key: 'threshold', label: 'Low-stock threshold', type: 'number' },
      ],
      rows.map((r) => ({
        product: r.product,
        variant: r.variant,
        sku: r.sku,
        warehouse: r.warehouse,
        onHand: r.on_hand,
        reserved: r.reserved,
        available: available(r),
        threshold: r.threshold,
      })),
    );
  }

  private async ratings(range: ReportRange, sellerId: string) {
    const reviews = await this.prisma.$queryRaw<
      { period: string; reviews: number; average: Num }[]
    >`
      SELECT ${bucket(Prisma.sql`"created_at"`, range.granularity)} AS "period",
        COUNT(*)::int AS "reviews", round(avg("rating"), 2) AS "average"
      FROM "product_reviews" WHERE "seller_id" = ${sellerId}::uuid AND "status" = 'PUBLISHED'
        AND "created_at" >= ${range.start} AND "created_at" < ${range.end}
      GROUP BY 1`;
    const [seller] = await this.prisma.$queryRaw<
      { count: number; overall: Num; quality: Num; shipping: Num; communication: Num }[]
    >`
      SELECT COUNT(*)::int AS "count", round(avg("overall"), 2) AS "overall",
        round(avg("product_quality"), 2) AS "quality", round(avg("shipping_speed"), 2) AS "shipping",
        round(avg("communication"), 2) AS "communication"
      FROM "seller_ratings" WHERE "seller_id" = ${sellerId}::uuid`;
    const products = await this.prisma.$queryRaw<
      { name: string; rating: Num; reviews: number; replied: number }[]
    >`
      SELECT p."name", p."rating_average" AS "rating", p."rating_count" AS "reviews",
        (SELECT COUNT(*)::int FROM "product_reviews" r WHERE r."product_id" = p."id" AND r."seller_reply" IS NOT NULL) AS "replied"
      FROM "products" p WHERE p."seller_id" = ${sellerId}::uuid AND p."rating_count" > 0
      ORDER BY p."rating_count" DESC LIMIT 200`;
    return this.report(
      'ratings',
      'Customer ratings',
      range,
      [
        {
          key: 'seller',
          label: 'Seller rating',
          value: n(seller?.overall).toFixed(2),
          unit: 'stars',
        },
        {
          key: 'quality',
          label: 'Product quality',
          value: n(seller?.quality).toFixed(2),
          unit: 'stars',
        },
        {
          key: 'shipping',
          label: 'Shipping',
          value: n(seller?.shipping).toFixed(2),
          unit: 'stars',
        },
        {
          key: 'communication',
          label: 'Communication',
          value: n(seller?.communication).toFixed(2),
          unit: 'stars',
        },
        {
          key: 'ratings',
          label: 'Seller ratings',
          value: String(seller?.count ?? 0),
          unit: 'count',
        },
      ],
      this.series(
        range,
        [
          { key: 'reviews', label: 'New reviews', unit: 'count' },
          { key: 'average', label: 'Average stars', unit: 'stars' },
        ],
        reviews,
      ),
      [
        { key: 'product', label: 'Product', type: 'text' },
        { key: 'rating', label: 'Rating', type: 'number' },
        { key: 'reviews', label: 'Reviews', type: 'number' },
        { key: 'replied', label: 'Replied', type: 'number' },
      ],
      products.map((p) => ({
        product: p.name,
        rating: n(p.rating).toFixed(2),
        reviews: p.reviews,
        replied: p.replied,
      })),
    );
  }

  private async commissions(range: ReportRange, sellerId: string) {
    const rows = await this.prisma.$queryRaw<
      {
        number: string;
        placed_at: Date;
        status: string;
        base: Num;
        commission: Num;
        reversal: Num;
      }[]
    >`
      SELECT so."number", o."placed_at", so."status"::text,
        (SELECT SUM(i."commission_base") FROM "order_items" i WHERE i."seller_order_id" = so."id") AS "base",
        so."commission_amount" AS "commission",
        (SELECT SUM(r."commission_reversal") FROM "refunds" r WHERE r."seller_order_id" = so."id" AND r."status" = 'SUCCEEDED') AS "reversal"
      FROM "seller_orders" so JOIN "orders" o ON o."id" = so."order_id"
      WHERE ${COUNTED} AND so."seller_id" = ${sellerId}::uuid
        AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      ORDER BY o."placed_at" DESC LIMIT 500`;
    const series = await this.prisma.$queryRaw<{ period: string; commission: Num; base: Num }[]>`
      SELECT ${bucket(Prisma.sql`o."placed_at"`, range.granularity)} AS "period",
        SUM(so."commission_amount") AS "commission",
        SUM((SELECT SUM(i."commission_base") FROM "order_items" i WHERE i."seller_order_id" = so."id")) AS "base"
      FROM "seller_orders" so JOIN "orders" o ON o."id" = so."order_id"
      WHERE ${COUNTED} AND so."seller_id" = ${sellerId}::uuid
        AND o."placed_at" >= ${range.start} AND o."placed_at" < ${range.end}
      GROUP BY 1`;
    const commission = series.reduce((s, r) => s + n(r.commission), 0);
    const base = series.reduce((s, r) => s + n(r.base), 0);
    const reversal = rows.reduce((s, r) => s + n(r.reversal), 0);
    return this.report(
      'commissions',
      'Commission deductions',
      range,
      [
        { key: 'commission', label: 'Commission', value: m(commission), unit: 'PHP' },
        { key: 'reversal', label: 'Given back for refunds', value: m(reversal), unit: 'PHP' },
        { key: 'net', label: 'Net commission', value: m(commission - reversal), unit: 'PHP' },
        { key: 'rate', label: 'Effective rate', value: percent(commission, base), unit: '%' },
      ],
      this.series(
        range,
        [
          { key: 'base', label: 'Commission base', unit: 'PHP' },
          { key: 'commission', label: 'Commission', unit: 'PHP' },
        ],
        series,
      ),
      [
        { key: 'number', label: 'Order', type: 'text' },
        { key: 'date', label: 'Placed', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'base', label: 'Commission base', type: 'money' },
        { key: 'commission', label: 'Commission', type: 'money' },
        { key: 'reversal', label: 'Reversed', type: 'money' },
      ],
      rows.map((r) => ({
        number: r.number,
        date: r.placed_at.toISOString().slice(0, 10),
        status: r.status,
        base: m(r.base),
        commission: m(r.commission),
        reversal: m(r.reversal),
      })),
    );
  }

  private async settlements(range: ReportRange, sellerId: string) {
    const rows = await this.prisma.settlement.findMany({
      where: { sellerId, createdAt: { gte: range.start, lt: range.end } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const series = await this.prisma.$queryRaw<{ period: string; net: Num; settlements: number }[]>`
      SELECT ${bucket(Prisma.sql`"created_at"`, range.granularity)} AS "period",
        SUM("net_settled") AS "net", COUNT(*)::int AS "settlements"
      FROM "settlements" WHERE "seller_id" = ${sellerId}::uuid
        AND "created_at" >= ${range.start} AND "created_at" < ${range.end}
      GROUP BY 1`;
    const sumOf = (k: 'grossSales' | 'commission' | 'netSettled' | 'withholdingTax') =>
      rows.reduce((s, r) => s + n(r[k]), 0);
    return this.report(
      'settlements',
      'Settlements',
      range,
      [
        { key: 'count', label: 'Statements', value: String(rows.length), unit: 'count' },
        { key: 'gross', label: 'Gross sales settled', value: m(sumOf('grossSales')), unit: 'PHP' },
        { key: 'commission', label: 'Commission', value: m(sumOf('commission')), unit: 'PHP' },
        { key: 'net', label: 'Net settled', value: m(sumOf('netSettled')), unit: 'PHP' },
        {
          key: 'withholding',
          label: 'Withholding tax',
          value: m(sumOf('withholdingTax')),
          unit: 'PHP',
        },
      ],
      this.series(range, [{ key: 'net', label: 'Net settled', unit: 'PHP' }], series),
      [
        { key: 'reference', label: 'Statement', type: 'text' },
        { key: 'period', label: 'Period', type: 'text' },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'gross', label: 'Gross sales', type: 'money' },
        { key: 'commission', label: 'Commission', type: 'money' },
        { key: 'fees', label: 'Payment fees', type: 'money' },
        { key: 'refunds', label: 'Refunds', type: 'money' },
        { key: 'net', label: 'Net settled', type: 'money' },
        { key: 'withholding', label: 'Withholding', type: 'money' },
      ],
      rows.map((r) => ({
        reference: r.reference,
        period: `${r.periodStart.toISOString().slice(0, 10)} – ${new Date(r.periodEnd.getTime() - 1).toISOString().slice(0, 10)}`,
        orders: r.ordersCount,
        gross: m(r.grossSales),
        commission: m(r.commission),
        fees: m(r.paymentFees),
        refunds: m(r.refunds),
        net: m(r.netSettled),
        withholding: m(r.withholdingTax),
      })),
    );
  }
}
