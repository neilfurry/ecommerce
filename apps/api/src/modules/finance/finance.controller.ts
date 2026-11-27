import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@marketplace/shared-types';
import {
  accountLedgerQuerySchema,
  accountLedgerSchema,
  codReconciliationSchema,
  commissionPreviewQuerySchema,
  commissionPreviewSchema,
  commissionReportSchema,
  commissionRuleDetailListSchema,
  commissionRuleDetailSchema,
  commissionRuleQuerySchema,
  createCommissionRuleSchema,
  createExpenseSchema,
  createLedgerAccountSchema,
  createTaxRuleSchema,
  eligibilityPreviewSchema,
  endRuleSchema,
  expenseListSchema,
  expenseSchema,
  financeDashboardSchema,
  financeDocumentListSchema,
  financeDocumentSchema,
  financePageQuery,
  financeSettingsResponseSchema,
  financeSettingsSchema,
  journalListSchema,
  journalQuerySchema,
  journalSchema,
  ledgerAccountListSchema,
  ledgerAccountSchema,
  manualJournalSchema,
  markPayoutPaidSchema,
  payExpenseSchema,
  payoutDecisionSchema,
  payoutDetailSchema,
  payoutListSchema,
  payoutQuerySchema,
  payoutReasonSchema,
  reconciliationReportSchema,
  refundReportSchema,
  reportPeriodQuerySchema,
  reserveSchema,
  reverseJournalSchema,
  revenueReportSchema,
  reviewBankAccountSchema,
  runSettlementResultSchema,
  runSettlementSchema,
  sellerBalanceListSchema,
  sellerBalancesSchema,
  sellerBankAccountListSchema,
  sellerBankAccountSchema,
  sellerTaxProfileSchema,
  settlementDetailSchema,
  settlementListSchema,
  settlementQuerySchema,
  settlementReportSchema,
  subledgerQuerySchema,
  subledgerSchema,
  taxRuleListSchema,
  taxRuleSchema,
  trialBalanceSchema,
  updateLedgerAccountSchema,
  verifySellerTaxSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import {
  CurrentUser,
  ReqContext,
  type RequestContext,
  RequirePermissions,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { Id } from '../orders/orders.controller';
import { CommissionRulesService } from '../settings/commission-rules.service';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { TaxRulesService } from '../settings/tax-rules.service';
import { BalancesService } from './balances.service';
import { ExpensesService } from './expenses.service';
import { LedgerService } from './ledger.service';
import { PayoutsService } from './payouts.service';
import { ReportsService } from './reports.service';
import { SettlementsService } from './settlements.service';

class PageQueryDto extends createZodDto(financePageQuery) {}
class PeriodQueryDto extends createZodDto(reportPeriodQuerySchema) {}
class FinanceSettingsDto extends createZodDto(financeSettingsSchema) {}
class CommissionQueryDto extends createZodDto(commissionRuleQuerySchema) {}
class CreateCommissionDto extends createZodDto(createCommissionRuleSchema) {}
class EndRuleDto extends createZodDto(endRuleSchema) {}
class PreviewQueryDto extends createZodDto(commissionPreviewQuerySchema) {}
class CreateTaxRuleDto extends createZodDto(createTaxRuleSchema) {}
class VerifyTaxDto extends createZodDto(verifySellerTaxSchema) {}
class CreateAccountDto extends createZodDto(createLedgerAccountSchema) {}
class UpdateAccountDto extends createZodDto(updateLedgerAccountSchema) {}
class AccountLedgerQueryDto extends createZodDto(accountLedgerQuerySchema) {}
class JournalQueryDto extends createZodDto(journalQuerySchema) {}
class ManualJournalDto extends createZodDto(manualJournalSchema) {}
class ReverseDto extends createZodDto(reverseJournalSchema) {}
class BalanceQueryDto extends createZodDto(
  financePageQuery.extend({
    q: z.string().trim().max(100).optional(),
    negativeOnly: z.stringbool().optional(),
  }),
) {}
class SubledgerQueryDto extends createZodDto(subledgerQuerySchema) {}
class ReserveDto extends createZodDto(reserveSchema) {}
class SettlementQueryDto extends createZodDto(settlementQuerySchema) {}
class RunSettlementDto extends createZodDto(runSettlementSchema) {}
class DocumentQueryDto extends createZodDto(
  financePageQuery.extend({ sellerId: z.uuid().optional() }),
) {}
class BankQueryDto extends createZodDto(
  z.object({
    status: sellerBankAccountSchema.shape.status.optional(),
    sellerId: z.uuid().optional(),
  }),
) {}
class ReviewBankDto extends createZodDto(reviewBankAccountSchema) {}
class PayoutQueryDto extends createZodDto(payoutQuerySchema) {}
class DecisionDto extends createZodDto(payoutDecisionSchema) {}
class ReasonDto extends createZodDto(payoutReasonSchema) {}
class MarkPaidDto extends createZodDto(markPayoutPaidSchema) {}
class ExpenseQueryDto extends createZodDto(
  financePageQuery.extend({ status: z.enum(['UNPAID', 'PAID', 'VOID']).optional() }),
) {}
class CreateExpenseDto extends createZodDto(createExpenseSchema) {}
class PayExpenseDto extends createZodDto(payExpenseSchema) {}
class PeriodDateDto extends createZodDto(z.object({ periodContaining: z.iso.date().optional() })) {}

const Code = () => Param('code', new ZodValidationPipe(z.string().regex(/^\d{4}$/)));

/** Admin Console finance (Phase 6). Reading needs finance.read; each change its own permission. */
@ApiTags('Finance (staff)')
@Controller({ path: 'finance', version: '1' })
@RequirePermissions('finance.read')
export class FinanceController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly commission: CommissionRulesService,
    private readonly taxes: TaxRulesService,
    private readonly ledger: LedgerService,
    private readonly balances: BalancesService,
    private readonly settlements: SettlementsService,
    private readonly payouts: PayoutsService,
    private readonly expenses: ExpensesService,
    private readonly reports: ReportsService,
  ) {}

  // ---- Dashboard and settings ----------------------------------------------------------------

  @Get('dashboard')
  @ApiOperation({ summary: 'Revenue, payables, cash, taxes and work queues for a period' })
  @ApiOkResponse({ schema: zodToOpenApi(financeDashboardSchema) })
  dashboard(@Query() q: PeriodQueryDto) {
    return this.reports.dashboard(q.from, q.to);
  }

  @Get('settings')
  @ApiOperation({
    summary: 'Fees and who bears them, settlement schedule, payouts, invoice issuer',
  })
  @ApiOkResponse({ schema: zodToOpenApi(financeSettingsResponseSchema) })
  async financeSettings() {
    return {
      ...(await this.settings.finance()),
      payMongoPayoutsConfigured: this.payouts.payMongoConfigured,
    };
  }

  @Put('settings')
  @RequirePermissions('finance.manage')
  @ApiOkResponse({ schema: zodToOpenApi(financeSettingsSchema) })
  saveSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: FinanceSettingsDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.settings.saveFinance(user, body, ctx);
  }

  // ---- Commission rules --------------------------------------------------------------------------

  @Get('commission-rules')
  @ApiOperation({
    summary: 'Commission rules (current, scheduled, ended) with their scope and dates',
  })
  @ApiOkResponse({ schema: zodToOpenApi(commissionRuleDetailListSchema) })
  commissionRules(@Query() q: CommissionQueryDto) {
    return this.commission.list(q as never);
  }

  @Get('commission-rules/preview')
  @ApiOperation({ summary: 'Which rule applies to a product (now or at a time), by precedence' })
  @ApiOkResponse({ schema: zodToOpenApi(commissionPreviewSchema) })
  commissionPreview(@Query() q: PreviewQueryDto) {
    return this.commission.preview(q.productId, q.at);
  }

  @Post('commission-rules')
  @RequirePermissions('commission.manage')
  @ApiOperation({
    summary: 'New rule version (ends the current rule for the same target where it starts)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(commissionRuleDetailSchema) })
  createCommissionRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateCommissionDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.commission.create(user, body, ctx);
  }

  @Post('commission-rules/:id/end')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('commission.manage')
  @ApiOkResponse({ schema: zodToOpenApi(commissionRuleDetailSchema) })
  endCommissionRule(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: EndRuleDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.commission.end(user, id, body, ctx);
  }

  // ---- Taxes ------------------------------------------------------------------------------------

  @Get('tax-rules')
  @ApiOkResponse({ schema: zodToOpenApi(taxRuleListSchema) })
  taxRules() {
    return this.taxes.list();
  }

  @Post('tax-rules')
  @RequirePermissions('tax.manage')
  @ApiOperation({
    summary: 'New tax rule version for a jurisdiction, what is taxed and seller registration',
  })
  @ApiOkResponse({ schema: zodToOpenApi(taxRuleSchema) })
  createTaxRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateTaxRuleDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.taxes.create(user, body, ctx);
  }

  @Post('tax-rules/:id/end')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tax.manage')
  @ApiOkResponse({ schema: zodToOpenApi(taxRuleSchema) })
  endTaxRule(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: EndRuleDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.taxes.end(user, id, body, ctx);
  }

  @Get('tax-profiles')
  @ApiOperation({ summary: 'Verified sellers whose tax registration finance has not checked yet' })
  taxProfilesToVerify() {
    return this.settlements.taxProfilesToVerify();
  }

  @Get('sellers/:id/tax-profile')
  @ApiOkResponse({ schema: zodToOpenApi(sellerTaxProfileSchema) })
  taxProfile(@Id() id: string) {
    return this.settlements.taxProfile(id);
  }

  @Post('sellers/:id/tax-profile/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tax.manage')
  @ApiOperation({
    summary: 'Record the TIN/CoR check and any accepted sworn declaration (withholding exemption)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerTaxProfileSchema) })
  verifyTax(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: VerifyTaxDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.settlements.verifyTax(user, id, body, ctx);
  }

  // ---- Ledger -----------------------------------------------------------------------------------

  @Get('accounts')
  @ApiOperation({ summary: 'Chart of accounts with balances' })
  @ApiOkResponse({ schema: zodToOpenApi(ledgerAccountListSchema) })
  accounts() {
    return this.ledger.accounts();
  }

  @Post('accounts')
  @RequirePermissions('ledger.post')
  @ApiOkResponse({ schema: zodToOpenApi(ledgerAccountSchema) })
  createAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAccountDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.ledger.createAccount(user, body, ctx);
  }

  @Patch('accounts/:id')
  @RequirePermissions('ledger.post')
  @ApiOkResponse({ schema: zodToOpenApi(ledgerAccountSchema) })
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: UpdateAccountDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.ledger.updateAccount(user, id, body, ctx);
  }

  @Get('accounts/:code/ledger')
  @ApiOperation({ summary: 'General ledger of one account with running balance' })
  @ApiOkResponse({ schema: zodToOpenApi(accountLedgerSchema) })
  accountLedger(@Code() code: string, @Query() q: AccountLedgerQueryDto) {
    return this.ledger.accountLedger(code, q as never);
  }

  @Get('journals')
  @ApiOkResponse({ schema: zodToOpenApi(journalListSchema) })
  journals(@Query() q: JournalQueryDto) {
    return this.ledger.journals(q as never);
  }

  @Get('journals/:id')
  @ApiOkResponse({ schema: zodToOpenApi(journalSchema) })
  journal(@Id() id: string) {
    return this.ledger.journal(id);
  }

  @Post('journals')
  @RequirePermissions('ledger.post')
  @ApiOperation({ summary: 'Draft a manual journal (posted separately)' })
  @ApiOkResponse({ schema: zodToOpenApi(journalSchema) })
  createJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ManualJournalDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.ledger.createManual(user, body, ctx);
  }

  @Put('journals/:id')
  @RequirePermissions('ledger.post')
  @ApiOkResponse({ schema: zodToOpenApi(journalSchema) })
  updateJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ManualJournalDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.ledger.updateDraft(user, id, body, ctx);
  }

  @Delete('journals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('ledger.post')
  @ApiOperation({ summary: 'Discard a draft (posted journals are never deleted)' })
  async deleteJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    await this.ledger.deleteDraft(user, id, ctx);
  }

  @Post('journals/:id/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ledger.post')
  @ApiOkResponse({ schema: zodToOpenApi(journalSchema) })
  postJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.ledger.post(user, id, ctx);
  }

  @Post('journals/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ledger.post')
  @ApiOperation({ summary: 'Post the reversal of a manual journal' })
  @ApiOkResponse({ schema: zodToOpenApi(journalSchema) })
  reverseJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReverseDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.ledger.reverse(user, id, body.reason, ctx);
  }

  // ---- Seller balances --------------------------------------------------------------------------

  @Get('balances')
  @ApiOperation({
    summary: 'Every seller’s pending, held, available, reserved, in-payout and paid amounts',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerBalanceListSchema) })
  sellerBalances(@Query() q: BalanceQueryDto) {
    return this.balances.list(q as never);
  }

  @Get('sellers/:id/balances')
  @ApiOkResponse({ schema: zodToOpenApi(sellerBalancesSchema) })
  sellerBalance(@Id() id: string) {
    return this.balances.balancesDto(id);
  }

  @Get('sellers/:id/subledger')
  @ApiOkResponse({ schema: zodToOpenApi(subledgerSchema) })
  subledger(@Id() id: string, @Query() q: SubledgerQueryDto) {
    return this.balances.subledger(id, q as never);
  }

  @Post('sellers/:id/reserve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settlements.manage')
  @ApiOperation({ summary: 'Hold back or release part of a seller’s available balance' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerBalancesSchema) })
  reserve(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReserveDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.balances.reserve(user, id, body, ctx);
  }

  // ---- Settlements and documents ---------------------------------------------------------------

  @Get('settlements')
  @ApiOkResponse({ schema: zodToOpenApi(settlementListSchema) })
  settlementList(@Query() q: SettlementQueryDto) {
    return this.settlements.list(q as never);
  }

  @Get('settlements/preview')
  @ApiOperation({
    summary: 'Sellers with orders a settlement of the (last closed) period would include',
  })
  @ApiOkResponse({ schema: zodToOpenApi(eligibilityPreviewSchema) })
  settlementPreview(@Query() q: PeriodDateDto) {
    return this.settlements.preview(q.periodContaining);
  }

  @Get('settlements/:id')
  @ApiOkResponse({ schema: zodToOpenApi(settlementDetailSchema) })
  settlement(@Id() id: string) {
    return this.settlements.detail(id, null);
  }

  @Post('settlements/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settlements.manage')
  @ApiOperation({ summary: 'Settle a closed period now (the worker also does it daily)' })
  @ApiOkResponse({ schema: zodToOpenApi(runSettlementResultSchema) })
  runSettlement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RunSettlementDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.settlements.run(user, body, ctx);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Service invoices and credit notes issued to sellers' })
  @ApiOkResponse({ schema: zodToOpenApi(financeDocumentListSchema) })
  documents(@Query() q: DocumentQueryDto) {
    return this.settlements.documents(q as never);
  }

  @Get('documents/:id')
  @ApiOkResponse({ schema: zodToOpenApi(financeDocumentSchema) })
  document(@Id() id: string) {
    return this.settlements.document(id, null);
  }

  // ---- Bank accounts and payouts -----------------------------------------------------------------

  @Get('bank-accounts')
  @ApiOkResponse({ schema: zodToOpenApi(sellerBankAccountListSchema) })
  bankAccounts(@Query() q: BankQueryDto) {
    return this.payouts.bankAccounts(q);
  }

  @Post('bank-accounts/:id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.approve')
  @ApiOkResponse({ schema: zodToOpenApi(sellerBankAccountSchema) })
  reviewBank(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReviewBankDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.reviewBankAccount(user, id, body, ctx);
  }

  @Get('payouts')
  @ApiOkResponse({ schema: zodToOpenApi(payoutListSchema) })
  payoutList(@Query() q: PayoutQueryDto) {
    return this.payouts.list(q as never);
  }

  @Get('payouts/:id')
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  payout(@Id() id: string) {
    return this.payouts.detail(id, { sellerId: null });
  }

  @Post('payouts/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.approve')
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: DecisionDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.approve(user, id, body.note ?? null, ctx);
  }

  @Post('payouts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.approve')
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReasonDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.reject(user, id, body.reason, ctx);
  }

  @Post('payouts/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.process')
  @ApiOperation({ summary: 'Record a payout paid by bank transfer (with the bank reference)' })
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: MarkPaidDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.markPaid(user, id, body, ctx);
  }

  @Post('payouts/:id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.process')
  @ApiOperation({ summary: 'Send an approved payout through PayMongo (when configured)' })
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.send(user, id, ctx);
  }

  @Post('payouts/:id/check')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.process')
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  check(@Id() id: string) {
    return this.payouts.check(id);
  }

  @Post('payouts/:id/mark-failed')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.process')
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  markFailed(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReasonDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.markFailed(user, id, body.reason, ctx);
  }

  @Post('payouts/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payouts.process')
  @ApiOperation({
    summary: 'A paid payout came back: reverse it (the amount returns to available)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(payoutDetailSchema) })
  reversePayout(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReasonDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.payouts.reverse(user, id, body.reason, ctx);
  }

  // ---- Expenses ---------------------------------------------------------------------------------

  @Get('expenses')
  @ApiOkResponse({ schema: zodToOpenApi(expenseListSchema) })
  expenseList(@Query() q: ExpenseQueryDto) {
    return this.expenses.list(q as never);
  }

  @Post('expenses')
  @RequirePermissions('ledger.post')
  @ApiOkResponse({ schema: zodToOpenApi(expenseSchema) })
  createExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateExpenseDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.expenses.create(user, body, ctx);
  }

  @Post('expenses/:id/pay')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ledger.post')
  @ApiOkResponse({ schema: zodToOpenApi(expenseSchema) })
  payExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: PayExpenseDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.expenses.pay(user, id, body.paymentReference, ctx);
  }

  @Post('expenses/:id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ledger.post')
  @ApiOkResponse({ schema: zodToOpenApi(expenseSchema) })
  voidExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReasonDto,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.expenses.void(user, id, body.reason, ctx);
  }

  // ---- Reports ----------------------------------------------------------------------------------

  @Get('reports/trial-balance')
  @ApiOkResponse({ schema: zodToOpenApi(trialBalanceSchema) })
  trialBalance(@Query() q: PeriodQueryDto) {
    return this.reports.trialBalance(q.from, q.to);
  }

  @Get('reports/revenue')
  @ApiOkResponse({ schema: zodToOpenApi(revenueReportSchema) })
  revenue(@Query() q: PeriodQueryDto) {
    return this.reports.revenue(q.from, q.to);
  }

  @Get('reports/commission')
  @ApiOkResponse({ schema: zodToOpenApi(commissionReportSchema) })
  commissionReport(@Query() q: PeriodQueryDto) {
    return this.reports.commission(q.from, q.to);
  }

  @Get('reports/refunds')
  @ApiOkResponse({ schema: zodToOpenApi(refundReportSchema) })
  refundReport(@Query() q: PeriodQueryDto) {
    return this.reports.refunds(q.from, q.to);
  }

  @Get('reports/cod')
  @ApiOperation({
    summary: 'COD collected, remitted and outstanding per courier vs the ledger receivable',
  })
  @ApiOkResponse({ schema: zodToOpenApi(codReconciliationSchema) })
  codReport(@Query() q: PeriodQueryDto) {
    return this.reports.cod(q.from, q.to);
  }

  @Get('reports/settlements')
  @ApiOkResponse({ schema: zodToOpenApi(settlementReportSchema) })
  settlementReport(@Query() q: PeriodQueryDto) {
    return this.reports.settlements(q.from, q.to);
  }

  @Get('reconciliation')
  @ApiOperation({
    summary: 'Checks between the ledger and payments, sales, refunds, COD and payouts',
  })
  @ApiOkResponse({ schema: zodToOpenApi(reconciliationReportSchema) })
  reconciliation() {
    return this.reports.reconciliation();
  }
}

export { PageQueryDto };
