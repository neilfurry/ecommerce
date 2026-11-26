import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser, CUSTOMER_ROLES } from '@marketplace/shared-types';
import {
  adminPaymentDetailSchema,
  adminPaymentListQuerySchema,
  adminPaymentListSchema,
  adminProofListQuerySchema,
  adminProofListSchema,
  adminProofSchema,
  bankProofInputSchema,
  codCollectionListQuerySchema,
  codCollectionListSchema,
  createRefundSchema,
  ledgerQuerySchema,
  markRefundPaidSchema,
  mockPaymentOutcomeSchema,
  mockPaymentSessionSchema,
  orderDetailSchema,
  paginationQuerySchema,
  paymentGatewayListSchema,
  reconciliationQuerySchema,
  reconciliationSchema,
  recordRemittanceSchema,
  refundListQuerySchema,
  refundListSchema,
  refundSchema,
  rejectProofSchema,
  remittanceListSchema,
  remittanceSchema,
  resolvePaymentSchema,
  sellerLedgerSchema,
  startPaymentResponseSchema,
  webhookAckSchema,
  webhookEventListQuerySchema,
  webhookEventListSchema,
  uuidSchema,
  webhookEventSchema,
} from '@marketplace/validation';
import type { Request } from 'express';
import {
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
  SkipCsrf,
} from '../../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../../common/openapi/zod-openapi';
import { createZodDto } from '../../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { AppConfig } from '../../../config/app-config';
import { requireFile } from '../../catalog/categories.controller';
import { CodService } from '../cod/cod.service';
import { Id } from '../orders.controller';
import { OrdersService } from '../orders.service';
import { RefundsService } from '../refunds/refunds.service';
import { PaymentsService } from './payments.service';
import { ReconciliationService } from './reconciliation.service';

class BankProofDto extends createZodDto(bankProofInputSchema) {}
class MockOutcomeDto extends createZodDto(mockPaymentOutcomeSchema) {}
class AdminPaymentQueryDto extends createZodDto(adminPaymentListQuerySchema) {}
class ResolvePaymentDto extends createZodDto(resolvePaymentSchema) {}
class WebhookEventQueryDto extends createZodDto(webhookEventListQuerySchema) {}
class ProofQueryDto extends createZodDto(adminProofListQuerySchema) {}
class RejectProofDto extends createZodDto(rejectProofSchema) {}
class ReconciliationQueryDto extends createZodDto(reconciliationQuerySchema) {}
class RefundQueryDto extends createZodDto(refundListQuerySchema) {}
class CreateRefundDto extends createZodDto(createRefundSchema) {}
class MarkPaidDto extends createZodDto(markRefundPaidSchema) {}
class CodQueryDto extends createZodDto(codCollectionListQuerySchema) {}
class RemittanceDto extends createZodDto(recordRemittanceSchema) {}
class PageQueryDto extends createZodDto(paginationQuerySchema) {}
class LedgerQueryDto extends createZodDto(ledgerQuerySchema) {}

const proofUpload = {
  schema: {
    type: 'object',
    required: ['file', 'bankName', 'referenceNumber', 'amount', 'transferredAt'],
    properties: {
      file: { type: 'string', format: 'binary', description: 'PDF, JPG or PNG' },
      bankName: { type: 'string' },
      referenceNumber: { type: 'string' },
      amount: { type: 'string', example: '1499.00' },
      transferredAt: { type: 'string', format: 'date-time' },
    },
  },
};

const stream = (content: {
  file: { contentType: string; sizeBytes: number };
  body: NodeJS.ReadableStream;
}) =>
  new StreamableFile(content.body as never, {
    type: content.file.contentType,
    length: content.file.sizeBytes,
    disposition: 'inline',
  });

@ApiTags('Account: payments')
@Controller({ path: 'account/orders', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class CustomerPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
  ) {}

  @Post(':id/payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pay now: the open hosted checkout, or a new attempt after a failed one',
  })
  @ApiOkResponse({ schema: zodToOpenApi(startPaymentResponseSchema) })
  start(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    return this.payments.startOnline(user, id);
  }

  @Post(':id/payments/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'After returning from the payment page: ask the provider (server to server) and show the result',
  })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  async verify(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    await this.payments.verify(id, { customerId: user.id });
    return this.orders.getMine(user, id);
  }

  @Post(':id/bank-transfer-proofs')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody(proofUpload)
  @ApiOperation({ summary: 'Upload proof of a bank transfer (finance confirms it)' })
  @ApiOkResponse({ schema: zodToOpenApi(orderDetailSchema) })
  async proof(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: BankProofDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    await this.payments.submitProof(user, id, body, requireFile(file));
    return this.orders.getMine(user, id);
  }

  @Get(':id/bank-transfer-proofs/:proofId/file')
  @ApiOperation({ summary: 'My uploaded transfer proof' })
  async proofFile(
    @CurrentUser() user: AuthenticatedUser,
    @Id() _id: string,
    @Param('proofId', new ZodValidationPipe(uuidSchema)) proofId: string,
  ) {
    return stream(await this.payments.proofFile(proofId, user.id));
  }
}

/** The mock provider's checkout page (storefront /pay/mock/:id) talks to these. Never in production. */
@ApiTags('Development: mock payments')
@Controller({ path: 'dev/mock-payments', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class MockPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly config: AppConfig,
  ) {}

  private ensure() {
    if (this.config.isProduction) throw new NotFoundException();
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'A test checkout session (owner only)' })
  @ApiOkResponse({ schema: zodToOpenApi(mockPaymentSessionSchema) })
  get(@CurrentUser() user: AuthenticatedUser, @Param('sessionId') sessionId: string) {
    this.ensure();
    return this.payments.mockSession(user, sessionId);
  }

  @Post(':sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Complete the test checkout as paid or failed (sent as a signed webhook; no money moves)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(mockPaymentSessionSchema) })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Body() body: MockOutcomeDto,
  ) {
    this.ensure();
    return this.payments.completeMock(user, sessionId, body.outcome);
  }
}

/** Provider webhooks: authenticated by their signature over the raw body, not by cookies. */
@ApiTags('Webhooks')
@Controller({ path: 'payments/webhooks', version: '1' })
@Public()
@SkipCsrf()
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('paymongo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PayMongo events (Paymongo-Signature verified)' })
  @ApiOkResponse({ schema: zodToOpenApi(webhookAckSchema) })
  paymongo(@Req() req: RawBodyRequest<Request>) {
    return this.payments.handleWebhook('PAYMONGO', req.headers, req.rawBody);
  }

  @Post('mock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mock provider events (x-mock-signature verified; development only)' })
  @ApiOkResponse({ schema: zodToOpenApi(webhookAckSchema) })
  mock(@Req() req: RawBodyRequest<Request>) {
    return this.payments.handleWebhook('MOCK', req.headers, req.rawBody);
  }
}

@ApiTags('Payments (staff)')
@Controller({ version: '1' })
@RequirePermissions('payments.read')
export class AdminPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly cod: CodService,
    private readonly reconciliation: ReconciliationService,
    private readonly orders: OrdersService,
  ) {}

  @Get('payments')
  @ApiOperation({
    summary: 'Payment attempts (filter: status, provider, method, review or failed queue)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(adminPaymentListSchema) })
  list(@Query() query: AdminPaymentQueryDto) {
    return this.payments.listPayments(query);
  }

  @Get('payments/gateways')
  @ApiOperation({ summary: 'Configured payment gateways (test or live) and prepared ones' })
  @ApiOkResponse({ schema: zodToOpenApi(paymentGatewayListSchema) })
  gateways() {
    return this.payments.gatewayStatuses();
  }

  @Get('payments/reconciliation')
  @ApiOperation({ summary: 'Received and refunded per method, COD with couriers, and exceptions' })
  @ApiOkResponse({ schema: zodToOpenApi(reconciliationSchema) })
  reconcile(@Query() query: ReconciliationQueryDto) {
    return this.reconciliation.report(query.from, query.to);
  }

  @Get('payments/webhook-events')
  @ApiOperation({ summary: 'Provider events received (payload not shown)' })
  @ApiOkResponse({ schema: zodToOpenApi(webhookEventListSchema) })
  webhookEvents(@Query() query: WebhookEventQueryDto) {
    return this.payments.listWebhookEvents(query);
  }

  @Post('payments/webhook-events/:id/reprocess')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.manage')
  @ApiOperation({ summary: 'Process a failed event again (safe: payments are applied once)' })
  @ApiOkResponse({ schema: zodToOpenApi(webhookEventSchema) })
  reprocess(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.payments.reprocessWebhookEvent(user, id, context);
  }

  @Get('payments/bank-transfer-proofs')
  @ApiOperation({
    summary: 'Bank transfer proofs (SUBMITTED: the verification queue, oldest first)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(adminProofListSchema) })
  proofs(@Query() query: ProofQueryDto) {
    return this.payments.listProofs(query);
  }

  @Get('payments/bank-transfer-proofs/:id/file')
  @ApiOperation({ summary: 'The uploaded proof file' })
  async proofFile(@Id() id: string) {
    return stream(await this.payments.proofFile(id, null));
  }

  @Post('payments/bank-transfer-proofs/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.manage')
  @ApiOperation({ summary: 'The transfer arrived in full: the order becomes paid' })
  @ApiOkResponse({ schema: zodToOpenApi(adminProofSchema) })
  approveProof(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.payments.approveProof(user, id, context);
  }

  @Post('payments/bank-transfer-proofs/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.manage')
  @ApiOperation({
    summary: 'The transfer could not be confirmed (the customer gets the reason and more time)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(adminProofSchema) })
  rejectProof(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: RejectProofDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.payments.rejectProof(user, id, body.reason, context);
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'A payment attempt with its history, proofs and refunds' })
  @ApiOkResponse({ schema: zodToOpenApi(adminPaymentDetailSchema) })
  get(@Id() id: string) {
    return this.payments.getPayment(id);
  }

  @Post('payments/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.manage')
  @ApiOperation({ summary: 'Mark a review item or failed payment as handled (with a note)' })
  @ApiOkResponse({ schema: zodToOpenApi(adminPaymentDetailSchema) })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ResolvePaymentDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.payments.resolvePayment(user, id, body.note, context);
  }

  @Post('orders/:id/payments/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.manage')
  @ApiOperation({ summary: 'Ask the provider for the state of the order’s open payments' })
  async verify(@CurrentUser() user: AuthenticatedUser, @Id() id: string) {
    await this.payments.verify(id, { staffId: user.id });
    return this.orders.getAny(user, id);
  }

  // ---- Refunds -------------------------------------------------------------------------------

  @Get('refunds')
  @ApiOperation({ summary: 'Refunds (filter by status, reason, reference or order)' })
  @ApiOkResponse({ schema: zodToOpenApi(refundListSchema) })
  listRefunds(@Query() query: RefundQueryDto) {
    return this.refunds.list(query);
  }

  @Get('refunds/:id')
  @ApiOkResponse({ schema: zodToOpenApi(refundSchema) })
  getRefund(@Id() id: string) {
    return this.refunds.get(id);
  }

  @Post('refunds')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('refunds.manage')
  @ApiOperation({ summary: 'Refund a seller order (full or partial) or a late/duplicate payment' })
  @ApiOkResponse({ schema: zodToOpenApi(refundSchema) })
  createRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateRefundDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.refunds.createByStaff(user, body, context);
  }

  @Post('refunds/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('refunds.manage')
  @ApiOperation({ summary: 'A manual refund was paid out (bank or e-wallet reference)' })
  @ApiOkResponse({ schema: zodToOpenApi(refundSchema) })
  markPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: MarkPaidDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.refunds.markPaid(user, id, body.payoutReference, context);
  }

  @Post('refunds/:id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('refunds.manage')
  @ApiOperation({ summary: 'Try a failed refund again (as a new refund)' })
  @ApiOkResponse({ schema: zodToOpenApi(refundSchema) })
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.refunds.retry(user, id, context);
  }

  @Post('refunds/:id/resend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('refunds.manage')
  @ApiOperation({
    summary: 'Send a refund whose provider call did not go through (idempotent at the provider)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(refundSchema) })
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @ReqContext() context: RequestContext,
  ) {
    return this.refunds.resend(user, id, context);
  }

  @Get('sellers/:id/ledger')
  @ApiOperation({ summary: 'A seller’s payables ledger and balance' })
  @ApiOkResponse({ schema: zodToOpenApi(sellerLedgerSchema) })
  ledger(@Id() id: string, @Query() query: PageQueryDto) {
    return this.refunds.ledger(null, { ...query, sellerId: id });
  }

  // ---- Cash on delivery ------------------------------------------------------------------------

  @Get('cod/collections')
  @ApiOperation({
    summary: 'Cash-on-delivery parcels (to collect, collected not remitted, remitted, failed)',
  })
  @ApiOkResponse({ schema: zodToOpenApi(codCollectionListSchema) })
  collections(@Query() query: CodQueryDto) {
    return this.cod.collections(query);
  }

  @Get('cod/remittances')
  @ApiOkResponse({ schema: zodToOpenApi(remittanceListSchema) })
  remittances(@Query() query: PageQueryDto) {
    return this.cod.remittances(query);
  }

  @Post('cod/remittances')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('cod.manage')
  @ApiOperation({
    summary: 'Record a courier remittance: only then is COD money counted as received',
  })
  @ApiOkResponse({ schema: zodToOpenApi(remittanceSchema) })
  recordRemittance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RemittanceDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.cod.recordRemittance(user, body, context);
  }
}

@ApiTags('Payables (seller)')
@Controller({ path: 'seller/ledger', version: '1' })
@RequirePermissions('seller.orders.read')
export class SellerLedgerController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  @ApiOperation({
    summary: 'My payables: earnings, commission, shipping credits and refunds, with the balance',
  })
  @ApiOkResponse({ schema: zodToOpenApi(sellerLedgerSchema) })
  ledger(@CurrentUser() user: AuthenticatedUser, @Query() query: LedgerQueryDto) {
    return this.refunds.ledger(user, query);
  }
}
