import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  createBankAccountSchema,
  financeDocumentListSchema,
  financeDocumentSchema,
  financePageQuery,
  financePeriodQuerySchema,
  payoutDetailSchema,
  payoutListSchema,
  payoutQuerySchema,
  requestPayoutSchema,
  sellerBankAccountListSchema,
  sellerBankAccountSchema,
  sellerFinanceOverviewSchema,
  sellerInvoiceSchema,
  sellerTaxNameSchema,
  sellerTaxProfileSchema,
  settlementDetailSchema,
  settlementListSchema,
  settlementQuerySchema,
  subledgerQuerySchema,
  subledgerSchema,
} from '@marketplace/validation';
import { sellerScope } from '../../common/auth/seller-scope';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Id } from '../orders/orders.controller';
import { BalancesService } from './balances.service';
import { conflict, notFound } from './finance-common';
import { PayoutsService } from './payouts.service';
import { SettlementsService } from './settlements.service';

class PeriodDto extends createZodDto(financePeriodQuerySchema) {}
class SubledgerQueryDto extends createZodDto(subledgerQuerySchema) {}
class SettlementQueryDto extends createZodDto(settlementQuerySchema.omit({ sellerId: true })) {}
class PageDto extends createZodDto(financePageQuery) {}
class PayoutQueryDto extends createZodDto(payoutQuerySchema.omit({ sellerId: true })) {}
class BankAccountDto extends createZodDto(createBankAccountSchema) {}
class RequestPayoutDto extends createZodDto(requestPayoutSchema) {}
class TaxNameDto extends createZodDto(sellerTaxNameSchema) {}
class SellerInvoiceDto extends createZodDto(sellerInvoiceSchema) {}

/** First and last day of the current Philippine month. */
function thisMonth() {
  const local = new Date(Date.now() + 8 * 3600 * 1000);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(mo + 1)}-01`, to: `${y}-${pad(mo + 1)}-${pad(last)}` };
}

/**
 * Seller Center finance (Phase 6). Everything is scoped to the signed-in user's seller
 * (sellerScope); another seller's records answer 404.
 */
@ApiTags('Seller: finance')
@Controller({ path: 'seller/finance', version: '1' })
@RequirePermissions('seller.finance.read')
export class SellerFinanceController {
  constructor(
    private readonly balances: BalancesService,
    private readonly settlements: SettlementsService,
    private readonly payouts: PayoutsService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Balances, sales and deductions for a period (default: this month)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerFinanceOverviewSchema) })
  overview(@CurrentUser() user: AuthenticatedUser, @Query() q: PeriodDto) {
    const month = thisMonth();
    return this.balances.overview(
      sellerScope(user).sellerId,
      q.from ?? month.from,
      q.to ?? month.to,
    );
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Statement of account: every line that changed the seller’s balances' })
  @ApiOkResponse({ schema: zodToOpenApi(subledgerSchema) })
  transactions(@CurrentUser() user: AuthenticatedUser, @Query() q: SubledgerQueryDto) {
    return this.balances.subledger(sellerScope(user).sellerId, q as never);
  }

  @Get('settlements')
  @ApiOkResponse({ schema: zodToOpenApi(settlementListSchema) })
  settlementList(@CurrentUser() user: AuthenticatedUser, @Query() q: SettlementQueryDto) {
    return this.settlements.list({
      ...(q as never as { page: number; pageSize: number }),
      sellerId: sellerScope(user).sellerId,
    });
  }

  @Get('settlements/:id')
  @ApiOkResponse({ schema: zodToOpenApi(settlementDetailSchema) })
  settlement(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.settlements.detail(id, sellerScope(user).sellerId);
  }

  @Get('documents')
  @ApiOperation({ summary: 'The marketplace’s service invoices and credit notes to this seller' })
  @ApiOkResponse({ schema: zodToOpenApi(financeDocumentListSchema) })
  documents(@CurrentUser() user: AuthenticatedUser, @Query() q: PageDto) {
    return this.settlements.documents({
      ...(q as never as { page: number; pageSize: number }),
      sellerId: sellerScope(user).sellerId,
    });
  }

  @Get('documents/:id')
  @ApiOkResponse({ schema: zodToOpenApi(financeDocumentSchema) })
  document(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.settlements.document(id, sellerScope(user).sellerId);
  }

  @Get('bank-accounts')
  @ApiOkResponse({ schema: zodToOpenApi(sellerBankAccountListSchema) })
  bankAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.payouts.bankAccounts({ sellerId: sellerScope(user).sellerId });
  }

  @Post('bank-accounts')
  @RequirePermissions('seller.payouts.manage')
  @ApiOperation({ summary: 'Add a bank or e-wallet account (finance verifies it before payouts)' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerBankAccountSchema) })
  addBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: BankAccountDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.addBankAccount(user, sellerScope(user).sellerId, body, ctx);
  }

  @Post('bank-accounts/:id/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.payouts.manage')
  @ApiOkResponse({ schema: zodToOpenApi(sellerBankAccountSchema) })
  disableBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.disableBankAccount(user, sellerScope(user).sellerId, id, ctx);
  }

  @Get('payouts')
  @ApiOkResponse({ schema: zodToOpenApi(payoutListSchema) })
  payoutList(@CurrentUser() user: AuthenticatedUser, @Query() q: PayoutQueryDto) {
    return this.payouts.list({
      ...(q as never as { page: number; pageSize: number }),
      sellerId: sellerScope(user).sellerId,
    });
  }

  @Get('payouts/:id')
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  payout(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.payouts.detail(id, { sellerId: sellerScope(user).sellerId });
  }

  @Post('payouts')
  @RequirePermissions('seller.payouts.manage')
  @ApiOperation({ summary: 'Request a payout of the available balance (idempotency key required)' })
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  requestPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RequestPayoutDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.request(user, sellerScope(user).sellerId, body, ctx);
  }

  @Post('payouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('seller.payouts.manage')
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  cancelPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.cancel(user, sellerScope(user).sellerId, id, ctx);
  }

  @Get('tax-profile')
  @ApiOkResponse({ schema: zodToOpenApi(sellerTaxProfileSchema) })
  taxProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.settlements.taxProfile(sellerScope(user).sellerId);
  }

  @Put('tax-profile')
  @RequirePermissions('seller.profile.manage')
  @ApiOperation({
    summary: 'Registered name on the BIR CoR (TIN and VAT status are in the business profile)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerTaxProfileSchema) })
  updateTaxProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TaxNameDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.settlements.updateTaxName(
      user,
      sellerScope(user).sellerId,
      body.taxRegisteredName,
      ctx,
    );
  }
}

/** The seller's own sales invoice reference on a seller order. */
@ApiTags('Seller: finance')
@Controller({ path: 'seller/orders', version: '1' })
@RequirePermissions('seller.orders.manage')
export class SellerInvoiceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Put(':id/sales-invoice')
  @ApiOperation({ summary: 'Record the seller’s sales invoice number and date for an order' })
  async setInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: SellerInvoiceDto,
    @ReqContext() ctx: RequestContext,
  ) {
    const { sellerId } = sellerScope(user);
    const so = await this.prisma.sellerOrder.findFirst({
      where: { id, sellerId },
      select: { id: true, status: true },
    });
    if (!so) throw notFound('Order');
    if (so.status === 'AWAITING_PAYMENT' || so.status === 'CANCELLED')
      throw conflict('Invoices are issued for placed orders.');
    await this.prisma.$transaction(async (tx) => {
      await tx.sellerOrder.update({
        where: { id },
        data: {
          sellerInvoiceNumber: body.sellerInvoiceNumber,
          sellerInvoiceDate: new Date(`${body.sellerInvoiceDate}T00:00:00Z`),
        },
      });
      await this.audit.record(
        {
          action: 'seller.sales_invoice_recorded',
          actorId: user.id,
          entityType: 'seller_order',
          entityId: id,
          metadata: { number: body.sellerInvoiceNumber },
        },
        ctx,
        tx,
      );
    });
    return { sellerInvoice: { number: body.sellerInvoiceNumber, date: body.sellerInvoiceDate } };
  }
}
