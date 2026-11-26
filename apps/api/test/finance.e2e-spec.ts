import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { postJournalInTx, Prisma } from '@marketplace/database';
import {
  apiErrorBodySchema,
  codReconciliationSchema,
  commissionPreviewSchema,
  commissionRuleDetailSchema,
  financeDocumentSchema,
  journalSchema,
  payoutDetailSchema,
  reconciliationReportSchema,
  refundSchema,
  runSettlementResultSchema,
  sellerBalancesSchema,
  sellerBankAccountSchema,
  sellerFinanceOverviewSchema,
  sellerOrderDetailSchema,
  settlementDetailSchema,
  taxRuleSchema,
  trialBalanceSchema,
} from '@marketplace/validation';
import type { Response } from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { signedInClient, type TestClient } from './auth-helpers';
import { testCategory } from './catalog-helpers';
import { acceptAndShip, courier, order, payMock, sellerOrderOf } from './order-helpers';
import { type Listed, listed, PLACES, shopper, shopSeller, type ShopSeller } from './shop-helpers';
import { createTestApp } from './test-app';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const errorCode = (res: Response) => apiErrorBodySchema.parse(res.body).error.code;
const day = (offsetDays: number) =>
  new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);

/**
 * Phase 6: commission engine, double-entry ledger, settlement, payouts, refunds after
 * settlement, COD reconciliation, tax rules and service invoices.
 */
describe('Finance (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestClient;
  let finance: TestClient;
  let categoryId: string;
  let parentId: string;
  let sellerA: ShopSeller;
  let sellerB: ShopSeller;
  let lamp: Listed;
  let mug: Listed;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    admin = (await signedInClient(app, 'admin', ['ADMIN'], 'finance-admin')).client;
    finance = (await signedInClient(app, 'admin', ['FINANCE_ADMIN'], 'finance-finance')).client;
    const leaf = await testCategory(app);
    categoryId = leaf.id;
    parentId = leaf.parentId!;
    sellerA = await shopSeller(app, PLACES.quezonCity);
    sellerB = await shopSeller(app, PLACES.cebuCity);
    lamp = await listed(sellerA, admin, categoryId, {
      name: 'Desk Lamp',
      price: '1000.00',
      stock: 100,
    });
    mug = await listed(sellerB, admin, categoryId, {
      name: 'Coffee Mug',
      price: '500.00',
      stock: 100,
    });
    // A category rate for this test's category tree (other suites keep the default).
    await finance
      .post('/api/v1/finance/commission-rules')
      .send({ scope: 'CATEGORY', type: 'PERCENTAGE', categoryId: parentId, ratePercent: '10' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const rule = async (body: Record<string, unknown>) =>
    commissionRuleDetailSchema.parse(
      (await finance.post('/api/v1/finance/commission-rules').send(body).expect(201)).body,
    );
  const preview = async (productId: string) =>
    commissionPreviewSchema.parse(
      (
        await finance
          .get(`/api/v1/finance/commission-rules/preview?productId=${productId}`)
          .expect(200)
      ).body,
    );
  const balances = async (client: TestClient) =>
    sellerFinanceOverviewSchema.parse(
      (await client.get('/api/v1/seller/finance/overview').expect(200)).body,
    ).balances;

  /** A paid (mock GCash) order of one item, delivered by the mock courier. */
  async function deliveredOrder(seller: ShopSeller, item: Listed, quantity = 1) {
    const buyer = await shopper(app);
    const placed = await order(buyer, [{ variantId: item.variantId, quantity }], 'GCASH');
    await payMock(buyer.client, placed);
    const so = placed.sellerOrders[0]!;
    const shipment = await acceptAndShip(seller.client, so.id);
    await courier(admin, shipment.id, 'PICKED_UP');
    await courier(admin, shipment.id, 'DELIVERED');
    return { buyer, placed, so };
  }

  /** Makes the return window end in the past, as if the order had been delivered weeks ago. */
  const windowEnded = (sellerOrderId: string) =>
    prisma.sellerOrder.update({
      where: { id: sellerOrderId },
      data: { returnWindowEndsAt: new Date(Date.now() - 12 * 86400 * 1000) },
    });

  const settle = async (seller: ShopSeller) =>
    runSettlementResultSchema.parse(
      (
        await finance
          .post('/api/v1/finance/settlements/run')
          .send({ periodContaining: day(-8), sellerId: seller.sellerId })
          .expect(200)
      ).body,
    );

  describe('commission engine', () => {
    it('applies rules by precedence: exemption > product > seller+category > seller > category > default', async () => {
      // Category rate (parent of the product's category) from beforeAll.
      let p = await preview(lamp.productId);
      expect(p.rule).toMatchObject({ scope: 'CATEGORY', ratePercent: '10.00' });
      expect(p.exampleOn1000).toBe('100.00');

      const sellerRule = await rule({
        scope: 'SELLER',
        type: 'PERCENTAGE',
        sellerId: sellerA.sellerId,
        ratePercent: '7',
      });
      p = await preview(lamp.productId);
      expect(p.rule?.id).toBe(sellerRule.id);

      const sellerCategory = await rule({
        scope: 'SELLER_CATEGORY',
        type: 'PERCENTAGE',
        sellerId: sellerA.sellerId,
        categoryId: parentId,
        ratePercent: '6',
      });
      expect((await preview(lamp.productId)).rule?.id).toBe(sellerCategory.id);

      // A fixed amount per unit for the product itself.
      const productRule = await rule({
        scope: 'PRODUCT',
        type: 'FIXED',
        productId: lamp.productId,
        fixedAmount: '25.00',
      });
      p = await preview(lamp.productId);
      expect(p.rule?.id).toBe(productRule.id);
      expect(p.exampleOn1000).toBe('25.00');

      // An exemption at a broader scope still wins (and needs commission.exempt: admins lack it).
      const exemption = {
        scope: 'SELLER',
        type: 'EXEMPT',
        sellerId: sellerA.sellerId,
        reason: 'Launch promotion',
      };
      const denied = await admin.post('/api/v1/finance/commission-rules').send(exemption);
      expect(denied.status).toBe(403);
      const exempt = await rule(exemption);
      p = await preview(lamp.productId);
      expect(p.rule?.id).toBe(exempt.id);
      expect(p.exampleOn1000).toBe('0.00');
      // The exemption replaced the seller-wide rate (same target): that rule has ended.
      const ended = commissionRuleDetailSchema.parse(
        (
          await finance
            .get(`/api/v1/finance/commission-rules?sellerId=${sellerA.sellerId}&state=ENDED`)
            .expect(200)
        ).body.items.find((r: { id: string }) => r.id === sellerRule.id),
      );
      expect(ended.state).toBe('ENDED');

      // Seller B's product is untouched by seller A's rules.
      expect((await preview(mug.productId)).rule).toMatchObject({ scope: 'CATEGORY' });

      // Back to the seller+category rate for the next tests.
      for (const r of [exempt, productRule]) {
        await finance.post(`/api/v1/finance/commission-rules/${r.id}/end`).send({}).expect(200);
      }
      expect((await preview(lamp.productId)).rule?.id).toBe(sellerCategory.id);
    });

    it('keeps the commission of placed orders when rules change (snapshot, immutable rows)', async () => {
      const buyer = await shopper(app);
      const placed = await order(buyer, [{ variantId: mug.variantId, quantity: 2 }], 'COD');
      const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.id } });
      expect(item).toMatchObject({ commissionScope: 'CATEGORY', commissionType: 'PERCENTAGE' });
      expect(item.commissionRate.toFixed(2)).toBe('10.00');
      expect(item.commissionAmount.toFixed(2)).toBe('100.00'); // 10% of 2 × 500

      // A new category rate does not change the order.
      const newer = await rule({
        scope: 'CATEGORY',
        type: 'PERCENTAGE',
        categoryId: parentId,
        ratePercent: '12',
      });
      const again = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(again.commissionAmount.toFixed(2)).toBe('100.00');
      expect(again.commissionRuleId).toBe(item.commissionRuleId);

      // The database refuses to edit or delete a rule or to change an order item's snapshot.
      await expect(
        prisma.commissionRule.update({ where: { id: newer.id }, data: { ratePercent: 1 } }),
      ).rejects.toThrow(/cannot be edited/);
      await expect(prisma.commissionRule.delete({ where: { id: newer.id } })).rejects.toThrow(
        /never deleted/,
      );
      await expect(
        prisma.orderItem.update({ where: { id: item.id }, data: { commissionAmount: 1 } }),
      ).rejects.toThrow(/snapshot/);

      // Restore the 10% category rate (a new version; history keeps both).
      await rule({
        scope: 'CATEGORY',
        type: 'PERCENTAGE',
        categoryId: parentId,
        ratePercent: '10',
      });
    });

    it('rejects rules starting in the past and conflicting scheduled rules', async () => {
      const past = await finance.post('/api/v1/finance/commission-rules').send({
        scope: 'PRODUCT',
        type: 'PERCENTAGE',
        productId: mug.productId,
        ratePercent: '3',
        effectiveFrom: new Date(Date.now() - 86400_000).toISOString(),
      });
      expect(past.status).toBe(422);
      const later = new Date(Date.now() + 7 * 86400_000).toISOString();
      const scheduled = await rule({
        scope: 'PRODUCT',
        type: 'PERCENTAGE',
        productId: mug.productId,
        ratePercent: '3',
        effectiveFrom: later,
      });
      expect(scheduled.state).toBe('SCHEDULED');
      // Not in force yet.
      expect((await preview(mug.productId)).rule).toMatchObject({ scope: 'CATEGORY' });
      const clash = await finance.post('/api/v1/finance/commission-rules').send({
        scope: 'PRODUCT',
        type: 'PERCENTAGE',
        productId: mug.productId,
        ratePercent: '4',
      });
      expect(clash.status).toBe(409);
      await finance
        .post(`/api/v1/finance/commission-rules/${scheduled.id}/end`)
        .send({})
        .expect(200);
    });
  });

  describe('double-entry ledger', () => {
    it('refuses unbalanced journals and any change to posted ones; posts an event once', async () => {
      await expect(
        prisma.$transaction((tx) =>
          postJournalInTx(tx, {
            type: 'MANUAL',
            description: 'Unbalanced',
            lines: [
              { account: '1010', amount: D('10.00') },
              { account: '4090', amount: D('-9.00') },
            ],
          }),
        ),
      ).rejects.toThrow(/does not balance/);
      // Even bypassing the code, the database trigger refuses to post it.
      const draft = await prisma.journalTransaction.create({
        data: {
          reference: `JE-T${randomUUID().slice(0, 6)}`,
          type: 'MANUAL',
          description: 'Raw',
          occurredAt: new Date(),
          entries: {
            create: [
              {
                lineNo: 1,
                accountId: (
                  await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: '1010' } })
                ).id,
                debit: 5,
              },
              {
                lineNo: 2,
                accountId: (
                  await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: '4090' } })
                ).id,
                credit: 4,
              },
            ],
          },
        },
      });
      await expect(
        prisma.journalTransaction.update({ where: { id: draft.id }, data: { status: 'POSTED' } }),
      ).rejects.toThrow(/does not balance/);
      await prisma.journalEntry.deleteMany({ where: { transactionId: draft.id } });
      await prisma.journalTransaction.delete({ where: { id: draft.id } });

      const key = `test:${randomUUID()}`;
      const post = () =>
        prisma.$transaction((tx) =>
          postJournalInTx(tx, {
            type: 'MANUAL',
            description: 'Idempotent',
            idempotencyKey: key,
            lines: [
              { account: '1010', amount: D('1.00') },
              { account: '3010', amount: D('-1.00') },
            ],
          }),
        );
      const results = await Promise.all([post(), post(), post()]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const posted = await prisma.journalTransaction.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      await expect(
        prisma.journalTransaction.update({
          where: { id: posted.id },
          data: { description: 'Edited' },
        }),
      ).rejects.toThrow(/cannot be changed/);
      await expect(prisma.journalTransaction.delete({ where: { id: posted.id } })).rejects.toThrow(
        /cannot be deleted/,
      );
      await expect(
        prisma.journalEntry.updateMany({ where: { transactionId: posted.id }, data: { debit: 2 } }),
      ).rejects.toThrow(/posted journal/);
    });

    it('drafts, posts and reverses a manual journal; the trial balance balances', async () => {
      const created = journalSchema.parse(
        (
          await finance
            .post('/api/v1/finance/journals')
            .send({
              description: 'Owner capital',
              occurredAt: day(0),
              lines: [
                { accountCode: '1010', debit: '1000.00' },
                { accountCode: '3010', credit: '1000.00' },
              ],
            })
            .expect(201)
        ).body,
      );
      expect(created.status).toBe('DRAFT');
      const unbalanced = await finance.post('/api/v1/finance/journals').send({
        description: 'Bad',
        occurredAt: day(0),
        lines: [
          { accountCode: '1010', debit: '10.00' },
          { accountCode: '3010', credit: '9.00' },
        ],
      });
      expect(unbalanced.status).toBe(400);
      const posted = journalSchema.parse(
        (await finance.post(`/api/v1/finance/journals/${created.id}/post`).expect(200)).body,
      );
      expect(posted).toMatchObject({
        status: 'POSTED',
        totalDebit: '1000.00',
        totalCredit: '1000.00',
      });
      expect((await finance.delete(`/api/v1/finance/journals/${created.id}`)).status).toBe(409);
      const reversal = journalSchema.parse(
        (
          await finance
            .post(`/api/v1/finance/journals/${created.id}/reverse`)
            .send({ reason: 'Entered twice' })
            .expect(200)
        ).body,
      );
      expect(reversal.reversalOf?.id).toBe(created.id);
      expect(reversal.entries.find((e) => e.account.code === '1010')?.credit).toBe('1000.00');
      expect(
        (
          await finance
            .post(`/api/v1/finance/journals/${created.id}/reverse`)
            .send({ reason: 'Again' })
        ).status,
      ).toBe(409);
      // A seller can never reach the ledger.
      expect((await sellerA.client.get('/api/v1/finance/journals')).status).toBe(403);

      const tb = trialBalanceSchema.parse(
        (
          await finance
            .get(`/api/v1/finance/reports/trial-balance?from=${day(-30)}&to=${day(0)}`)
            .expect(200)
        ).body,
      );
      expect(tb.balanced).toBe(true);
    });
  });

  describe('settlement and payouts', () => {
    let settledOrderId: string;

    it('settles eligible orders: commission, withholding, statement and service invoice', async () => {
      const { so } = await deliveredOrder(sellerA, lamp, 2);
      // The 6% seller+category rate applies: 6% of 2 × 1000.
      const detail = await sellerOrderOf(sellerA.client, so.id);
      expect(detail.commission.items[0]).toMatchObject({
        scope: 'SELLER_CATEGORY',
        type: 'PERCENTAGE',
        ratePercent: '6.00',
        amount: '120.00',
      });
      let b = await balances(sellerA.client);
      expect(b.pending).toBe('1880.00');
      expect(b.held).toBe('0.00');
      expect(b.available).toBe('0.00');

      // Still inside the return window: nothing to settle.
      expect((await settle(sellerA)).settled).toHaveLength(0);
      await windowEnded(so.id);
      const run = await settle(sellerA);
      expect(run.settled).toHaveLength(1);
      const settlement = settlementDetailSchema.parse(
        (
          await finance
            .get(`/api/v1/finance/settlements/${run.settled[0]!.settlementId}`)
            .expect(200)
        ).body,
      );
      // Not VAT-registered: withholding on the whole gross (½%) per the seeded rule.
      expect(settlement).toMatchObject({
        ordersCount: 1,
        grossSales: '2000.00',
        commission: '120.00',
        netSettled: '1880.00',
        withholdingBase: '2000.00',
        withholdingTax: '10.00',
        openingAvailable: '0.00',
        closingAvailable: '1870.00',
      });
      expect(settlement.lines[0]).toMatchObject({ sellerOrderId: so.id, net: '1880.00' });
      settledOrderId = so.id;
      b = await balances(sellerA.client);
      expect(b).toMatchObject({ pending: '0.00', available: '1870.00' });

      // The marketplace's service invoice for the commission: VAT split out at 12% inclusive.
      const invoiceRef = settlement.documents.find((d) => d.type === 'SERVICE_INVOICE')!;
      const invoice = financeDocumentSchema.parse(
        (await sellerA.client.get(`/api/v1/seller/finance/documents/${invoiceRef.id}`).expect(200))
          .body,
      );
      expect(invoice.number).toMatch(/^SI-\d{4}-\d{6}$/);
      expect(invoice).toMatchObject({
        total: '120.00',
        taxAmount: cents(D(120).times(12).dividedBy(112)).toFixed(2),
      });
      // Other sellers cannot see it.
      expect(
        (await sellerB.client.get(`/api/v1/seller/finance/documents/${invoiceRef.id}`)).status,
      ).toBe(404);
      expect(
        (await sellerB.client.get(`/api/v1/seller/finance/settlements/${settlement.id}`)).status,
      ).toBe(404);

      // Settling again changes nothing: one settlement per period and one per order.
      expect((await settle(sellerA)).settled).toHaveLength(0);
      await expect(
        prisma.settlement.update({ where: { id: settlement.id }, data: { ordersCount: 9 } }),
      ).rejects.toThrow(/append-only/);
    });

    it('requests, approves and pays a payout; the bank account number never leaves the server', async () => {
      const added = sellerBankAccountSchema.parse(
        (
          await sellerA.client
            .post('/api/v1/seller/finance/bank-accounts')
            .send({
              institutionName: 'BDO Unibank',
              institutionCode: 'BNORPHMM',
              accountName: 'Test Trading',
              accountNumber: '001234567890',
            })
            .expect(201)
        ).body,
      );
      expect(added).toMatchObject({
        status: 'PENDING_VERIFICATION',
        accountNumberMasked: '•••• 7890',
      });
      expect(JSON.stringify(added)).not.toContain('001234567890');
      const stored = await prisma.sellerBankAccount.findUniqueOrThrow({ where: { id: added.id } });
      expect(stored.accountNumberEncrypted).not.toContain('001234567890');
      const audit = await prisma.auditLog.findMany({ where: { entityId: added.id } });
      expect(JSON.stringify(audit)).not.toContain('001234567890');

      const request = (amount: string, key = randomUUID()) =>
        sellerA.client
          .post('/api/v1/seller/finance/payouts')
          .send({ amount, bankAccountId: added.id, idempotencyKey: key });
      // Not verified yet: first the tax profile (BIR registration), then the bank account.
      expect(errorCode(await request('500.00'))).toBe('CONFLICT');
      await prisma.seller.update({
        where: { id: sellerA.sellerId },
        data: { tin: '123456789000' },
      });
      await finance
        .post(`/api/v1/finance/sellers/${sellerA.sellerId}/tax-profile/verify`)
        .send({ verified: true, withholdingExemptUntil: null })
        .expect(200);
      expect((await request('500.00')).status).toBe(422);
      await finance
        .post(`/api/v1/finance/bank-accounts/${added.id}/review`)
        .send({ decision: 'VERIFY' })
        .expect(200);
      // More than available, and under the minimum.
      expect((await request('5000.00')).status).toBe(422);
      expect((await request('50.00')).status).toBe(422);

      const key = randomUUID();
      const first = payoutDetailSchema.parse((await request('1000.00', key).expect(201)).body);
      const retried = payoutDetailSchema.parse((await request('1000.00', key).expect(201)).body);
      expect(retried.id).toBe(first.id);
      expect(first).toMatchObject({ status: 'REQUESTED', amount: '1000.00' });
      expect(await balances(sellerA.client)).toMatchObject({
        available: '870.00',
        inPayout: '1000.00',
      });

      // Sellers cannot approve; finance approves and records the bank transfer.
      expect(
        (await sellerA.client.post(`/api/v1/finance/payouts/${first.id}/approve`).send({})).status,
      ).toBe(403);
      await finance.post(`/api/v1/finance/payouts/${first.id}/approve`).send({}).expect(200);
      const paid = payoutDetailSchema.parse(
        (
          await finance
            .post(`/api/v1/finance/payouts/${first.id}/mark-paid`)
            .send({ transferReference: 'BDO-778899' })
            .expect(200)
        ).body,
      );
      expect(paid).toMatchObject({
        status: 'PAID',
        transferReference: 'BDO-778899',
        actions: ['REVERSE'],
      });
      expect(paid.events.map((e) => e.type)).toEqual(['REQUESTED', 'APPROVED', 'PAID']);
      expect(await balances(sellerA.client)).toMatchObject({
        available: '870.00',
        inPayout: '0.00',
        paid: '1000.00',
      });
      expect(
        (
          await finance
            .post(`/api/v1/finance/payouts/${first.id}/mark-paid`)
            .send({ transferReference: 'again' })
        ).status,
      ).toBe(409);
    });

    it('returns failed, rejected and reversed payouts to the available balance', async () => {
      const account = (
        await prisma.sellerBankAccount.findFirstOrThrow({
          where: { sellerId: sellerA.sellerId, status: 'VERIFIED' },
        })
      ).id;
      const request = async (amount: string) =>
        payoutDetailSchema.parse(
          (
            await sellerA.client
              .post('/api/v1/seller/finance/payouts')
              .send({ amount, bankAccountId: account, idempotencyKey: randomUUID() })
              .expect(201)
          ).body,
        );
      const failing = await request('300.00');
      await finance.post(`/api/v1/finance/payouts/${failing.id}/approve`).send({}).expect(200);
      const failed = payoutDetailSchema.parse(
        (
          await finance
            .post(`/api/v1/finance/payouts/${failing.id}/mark-failed`)
            .send({ reason: 'Account name mismatch' })
            .expect(200)
        ).body,
      );
      expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'Account name mismatch' });
      expect(await balances(sellerA.client)).toMatchObject({
        available: '870.00',
        inPayout: '0.00',
      });

      const rejected = await request('200.00');
      await finance
        .post(`/api/v1/finance/payouts/${rejected.id}/reject`)
        .send({ reason: 'Duplicate request' })
        .expect(200);
      const cancelled = await request('100.00');
      await sellerA.client
        .post(`/api/v1/seller/finance/payouts/${cancelled.id}/cancel`)
        .expect(200);
      expect(await balances(sellerA.client)).toMatchObject({
        available: '870.00',
        inPayout: '0.00',
      });

      const returned = await request('400.00');
      await finance.post(`/api/v1/finance/payouts/${returned.id}/approve`).send({}).expect(200);
      await finance
        .post(`/api/v1/finance/payouts/${returned.id}/mark-paid`)
        .send({ transferReference: 'BDO-1' })
        .expect(200);
      expect(await balances(sellerA.client)).toMatchObject({
        available: '470.00',
        paid: '1400.00',
      });
      await finance
        .post(`/api/v1/finance/payouts/${returned.id}/reverse`)
        .send({ reason: 'Returned by the bank' })
        .expect(200);
      expect(await balances(sellerA.client)).toMatchObject({
        available: '870.00',
        paid: '1000.00',
        inPayout: '0.00',
      });
    });

    it('takes a refund after settlement from the available balance and gives back commission with its VAT', async () => {
      const before = await balances(sellerA.client);
      const refund = refundSchema.parse(
        (
          await finance
            .post('/api/v1/refunds')
            .send({
              sellerOrderId: settledOrderId,
              reason: 'OTHER',
              kind: 'PARTIAL',
              amount: '500.00',
              note: 'Scratched lamp, seller agreed',
              idempotencyKey: randomUUID(),
            })
            .expect(200)
        ).body,
      );
      const row = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
      expect(row.status).toBe('SUCCEEDED');
      const after = await balances(sellerA.client);
      expect(D(after.pending).toFixed(2)).toBe(before.pending);
      expect(D(before.available).sub(after.available).toFixed(2)).toBe(
        row.sellerDebit.sub(row.commissionReversal).toFixed(2),
      );
      const journal = await prisma.journalTransaction.findUniqueOrThrow({
        where: { idempotencyKey: `refund:${refund.id}` },
        include: { entries: { include: { account: true } } },
      });
      const debit = journal.entries.reduce((s, e) => s.add(e.debit), D(0));
      const credit = journal.entries.reduce((s, e) => s.add(e.credit), D(0));
      expect(debit.toFixed(2)).toBe(credit.toFixed(2));
      if (row.commissionReversal.gt(0)) {
        const vat = journal.entries.find((e) => e.account.code === '2310')!;
        expect(vat.debit.toFixed(2)).toBe(
          cents(row.commissionReversal.times(12).dividedBy(112)).toFixed(2),
        );
      }
      // The seller order shows the refund in its ledger lines (settlement moves are hidden).
      const view = sellerOrderDetailSchema.parse(
        (await sellerA.client.get(`/api/v1/seller/orders/${settledOrderId}`).expect(200)).body,
      );
      expect(view.settlement).not.toBeNull();
      expect(view.ledger.map((e) => e.type)).toEqual(
        expect.arrayContaining(['SALE', 'COMMISSION', 'REFUND']),
      );
    });

    it('holds back and releases part of the available balance (reserve)', async () => {
      const b = await balances(sellerA.client);
      const place = await finance
        .post(`/api/v1/finance/sellers/${sellerA.sellerId}/reserve`)
        .send({ action: 'PLACE', amount: '100.00', reason: 'Chargeback risk' })
        .expect(200);
      expect(sellerBalancesSchema.parse(place.body)).toMatchObject({
        reserved: '100.00',
        available: D(b.available).sub(100).toFixed(2),
      });
      const tooMuch = await finance
        .post(`/api/v1/finance/sellers/${sellerA.sellerId}/reserve`)
        .send({ action: 'RELEASE', amount: '200.00', reason: 'Too much' });
      expect(tooMuch.status).toBe(409);
      await finance
        .post(`/api/v1/finance/sellers/${sellerA.sellerId}/reserve`)
        .send({ action: 'RELEASE', amount: '100.00', reason: 'Cleared' })
        .expect(200);
      expect((await balances(sellerA.client)).available).toBe(b.available);
    });
  });

  describe('COD and fees', () => {
    it('reconciles COD collected, remitted with a shortage, and the ledger receivable', async () => {
      const buyer = await shopper(app);
      const placed = await order(buyer, [{ variantId: mug.variantId, quantity: 1 }], 'COD');
      const so = placed.sellerOrders[0]!;
      const shipment = await acceptAndShip(sellerB.client, so.id);
      await courier(admin, shipment.id, 'PICKED_UP');
      await courier(admin, shipment.id, 'DELIVERED');
      const collection = await prisma.codCollection.findUniqueOrThrow({
        where: { sellerOrderId: so.id },
      });
      const collected = await prisma.journalTransaction.findUniqueOrThrow({
        where: { idempotencyKey: `cod-collected:${collection.id}` },
      });
      expect(collected.status).toBe('POSTED');
      // Nothing is earned before the remittance.
      expect(
        await prisma.journalTransaction.count({ where: { idempotencyKey: `sale:${so.id}` } }),
      ).toBe(0);
      const received = D(so.total).sub(15);
      await finance
        .post('/api/v1/cod/remittances')
        .send({
          carrier: 'MOCK',
          reference: `RMT-F${Date.now()}`,
          remittedAt: new Date().toISOString(),
          amount: received.toFixed(2),
          collectionIds: [collection.id],
          discrepancyNote: 'Courier COD fee deducted',
        })
        .expect(200);
      const remittance = await prisma.journalTransaction.findFirstOrThrow({
        where: {
          sourceType: 'COD_REMITTANCE',
          entries: { some: { account: { code: '1100' }, credit: D(so.total) } },
        },
        orderBy: { createdAt: 'desc' },
        include: { entries: { include: { account: true } } },
      });
      expect(remittance.entries.find((e) => e.account.code === '5020')?.debit.toFixed(2)).toBe(
        '15.00',
      );
      expect(
        await prisma.journalTransaction.count({ where: { idempotencyKey: `sale:${so.id}` } }),
      ).toBe(1);
      const report = codReconciliationSchema.parse(
        (await finance.get(`/api/v1/finance/reports/cod?from=${day(-1)}&to=${day(0)}`).expect(200))
          .body,
      );
      const mock = report.rows.find((r) => r.carrier === 'MOCK')!;
      expect(D(mock.remittedExpected).gte(so.total)).toBe(true);
      expect(D(mock.difference).lte(-15)).toBe(true);
    });

    it('recovers the configured payment fee from the seller, with VAT on the recovery', async () => {
      const current = (await finance.get('/api/v1/finance/settings').expect(200)).body as Record<
        string,
        unknown
      > & {
        fees: { methods: Record<string, unknown> };
      };
      const { payMongoPayoutsConfigured: _configured, ...settings } = current;
      // MAYA only: other suites pay with GCash and COD.
      await finance
        .put('/api/v1/finance/settings')
        .send({
          ...settings,
          fees: {
            ...current.fees,
            methods: { ...current.fees.methods, MAYA: { percent: '2', fixed: '0.00' } },
          },
        })
        .expect(200);
      try {
        const buyer = await shopper(app);
        const placed = await order(buyer, [{ variantId: mug.variantId, quantity: 1 }], 'MAYA');
        await payMock(buyer.client, placed);
        const attempt = placed.payment.attempts[0]!;
        const fee = await prisma.journalTransaction.findUniqueOrThrow({
          where: { idempotencyKey: `fee:${attempt.id}` },
          include: { entries: { include: { account: true } } },
        });
        const expected = cents(D(attempt.amount).times(2).dividedBy(100));
        const line = (code: string) => fee.entries.filter((e) => e.account.code === code);
        expect(line('5010')[0]!.debit.toFixed(2)).toBe(expected.toFixed(2));
        expect(line('2110')[0]!.debit.toFixed(2)).toBe(expected.toFixed(2));
        expect(line('2110')[0]!.sellerId).toBe(sellerB.sellerId);
        const recovery = line('4020')[0]!.credit.add(line('2310')[0]?.credit ?? 0);
        expect(recovery.toFixed(2)).toBe(expected.toFixed(2));
      } finally {
        await finance.put('/api/v1/finance/settings').send(settings).expect(200);
      }
    });
  });

  describe('taxes', () => {
    it('versions tax rules per jurisdiction without touching history', async () => {
      const body = {
        code: 'SG-GST',
        name: 'GST',
        jurisdiction: 'SG',
        kind: 'VAT',
        appliesTo: 'GOODS',
        sellerRegistration: 'VAT_REGISTERED',
        ratePercent: '9',
        inclusive: true,
      };
      expect((await admin.post('/api/v1/finance/tax-rules').send(body)).status).toBe(403);
      const first = taxRuleSchema.parse(
        (await finance.post('/api/v1/finance/tax-rules').send(body).expect(201)).body,
      );
      const second = taxRuleSchema.parse(
        (
          await finance
            .post('/api/v1/finance/tax-rules')
            .send({ ...body, ratePercent: '10' })
            .expect(201)
        ).body,
      );
      const rules = (await finance.get('/api/v1/finance/tax-rules').expect(200)).body.items as {
        id: string;
        state: string;
      }[];
      expect(rules.find((r) => r.id === first.id)?.state).toBe('ENDED');
      expect(rules.find((r) => r.id === second.id)?.state).toBe('CURRENT');
      const bad = await finance
        .post('/api/v1/finance/tax-rules')
        .send({ ...body, appliesTo: 'MARKETPLACE_SERVICES', inclusive: false });
      expect(bad.status).toBe(400);
      await finance.post(`/api/v1/finance/tax-rules/${second.id}/end`).send({}).expect(200);
    });

    it('records the seller’s own sales invoice on an order', async () => {
      const { so } = await deliveredOrder(sellerB, mug);
      await sellerB.client
        .put(`/api/v1/seller/orders/${so.id}/sales-invoice`)
        .send({ sellerInvoiceNumber: 'INV-0001', sellerInvoiceDate: day(0) })
        .expect(200);
      expect(
        (
          await sellerA.client
            .put(`/api/v1/seller/orders/${so.id}/sales-invoice`)
            .send({ sellerInvoiceNumber: 'X', sellerInvoiceDate: day(0) })
        ).status,
      ).toBe(404);
      expect((await sellerOrderOf(sellerB.client, so.id)).sellerInvoice).toEqual({
        number: 'INV-0001',
        date: day(0),
      });
    });
  });

  it('reconciliation checks pass: journals balance and every money event is posted', async () => {
    const report = reconciliationReportSchema.parse(
      (await finance.get('/api/v1/finance/reconciliation').expect(200)).body,
    );
    const failed = report.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
  });
});
