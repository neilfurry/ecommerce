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
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedUser,
  CUSTOMER_ROLES,
  NOTIFICATION_CHANNELS,
} from '@marketplace/shared-types';
import {
  adminLoyaltyAccountListSchema,
  adminLoyaltyAccountSchema,
  affiliateAccountListSchema,
  affiliateAccountSchema,
  affiliateApplicationSchema,
  affiliateClickSchema,
  affiliateConversionListSchema,
  affiliateConversionQuerySchema,
  affiliateListQuerySchema,
  affiliatePayoutListSchema,
  affiliatePayoutSchema,
  affiliateReportSchema,
  affiliateSettingsSchema,
  loyaltyAdjustmentSchema,
  loyaltySettingsSchema,
  loyaltySummarySchema,
  loyaltyTransactionListSchema,
  loyaltyTransactionQuerySchema,
  markNotificationsReadSchema,
  myReferralsSchema,
  notificationDeliveryListSchema,
  notificationDeliveryQuerySchema,
  notificationListQuerySchema,
  notificationListSchema,
  notificationPreferencesSchema,
  notificationTemplateListSchema,
  notificationTemplateSchema,
  paginationQuerySchema,
  pushSubscriptionInputSchema,
  recordAffiliatePayoutSchema,
  reviewAffiliateSchema,
  updateNotificationPreferencesSchema,
  upsertNotificationTemplateSchema,
  uuidSchema,
} from '@marketplace/validation';
import { z } from 'zod';
import {
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
  RequirePermissions,
  Roles,
} from '../../common/auth/auth.decorators';
import { zodToOpenApi } from '../../common/openapi/zod-openapi';
import { createZodDto } from '../../common/validation/zod-dto';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AffiliatesService } from './affiliates.service';
import { LoyaltyService } from './loyalty.service';
import { NotificationCenterService } from './notification-center.service';

class LoyaltySettingsDto extends createZodDto(loyaltySettingsSchema) {}
class AffiliateSettingsDto extends createZodDto(affiliateSettingsSchema) {}
class LoyaltyTxQueryDto extends createZodDto(loyaltyTransactionQuerySchema) {}
class AccountsQueryDto extends createZodDto(
  paginationQuerySchema.extend({ search: z.string().trim().max(100).optional() }),
) {}
class AdjustmentDto extends createZodDto(loyaltyAdjustmentSchema) {}
class ApplicationDto extends createZodDto(affiliateApplicationSchema) {}
class ClickDto extends createZodDto(affiliateClickSchema) {}
class AffiliateListQueryDto extends createZodDto(affiliateListQuerySchema) {}
class ConversionQueryDto extends createZodDto(affiliateConversionQuerySchema) {}
class ReviewAffiliateDto extends createZodDto(reviewAffiliateSchema) {}
class PayoutDto extends createZodDto(recordAffiliatePayoutSchema) {}
class NotificationQueryDto extends createZodDto(notificationListQuerySchema) {}
class MarkReadDto extends createZodDto(markNotificationsReadSchema) {}
class PreferencesDto extends createZodDto(updateNotificationPreferencesSchema) {}
class PushDto extends createZodDto(pushSubscriptionInputSchema) {}
class UnsubscribeDto extends createZodDto(z.object({ endpoint: z.url().max(500) })) {}
class TemplateDto extends createZodDto(upsertNotificationTemplateSchema) {}
class DeliveryQueryDto extends createZodDto(notificationDeliveryQuerySchema) {}
const Id = (name = 'id') => Param(name, new ZodValidationPipe(uuidSchema));
const channelSchema = z.enum(NOTIFICATION_CHANNELS);

// ---- Customers -----------------------------------------------------------------------------

@ApiTags('Account: loyalty, referrals and affiliate')
@Controller({ path: 'account', version: '1' })
@Roles(...CUSTOMER_ROLES)
export class AccountEngagementController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly affiliates: AffiliatesService,
  ) {}

  @Get('loyalty')
  @ApiOperation({ summary: 'My points: balance, expiring soon, points on the way, the rules' })
  @ApiOkResponse({ schema: zodToOpenApi(loyaltySummarySchema) })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.summary(user.id);
  }

  @Get('loyalty/transactions')
  @ApiOperation({ summary: 'My points history (the ledger)' })
  @ApiOkResponse({ schema: zodToOpenApi(loyaltyTransactionListSchema) })
  transactions(@CurrentUser() user: AuthenticatedUser, @Query() query: LoyaltyTxQueryDto) {
    return this.loyalty.transactions(user.id, query);
  }

  @Get('referrals')
  @ApiOperation({ summary: 'My referral code and link, and the friends who joined with it' })
  @ApiOkResponse({ schema: zodToOpenApi(myReferralsSchema) })
  referrals(@CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.referrals(user);
  }

  @Post('affiliate')
  @ApiOperation({ summary: 'Apply to the affiliate programme (reviewed by the marketplace)' })
  @ApiOkResponse({ schema: zodToOpenApi(affiliateAccountSchema) })
  apply(@CurrentUser() user: AuthenticatedUser, @Body() body: ApplicationDto) {
    return this.affiliates.apply(user, body);
  }

  @Get('affiliate')
  @ApiOperation({ summary: 'My affiliate account, link and totals' })
  @ApiOkResponse({ schema: zodToOpenApi(affiliateAccountSchema) })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.affiliates.me(user);
  }

  @Get('affiliate/report')
  @ApiOperation({ summary: 'My affiliate report by month' })
  @ApiOkResponse({ schema: zodToOpenApi(affiliateReportSchema) })
  report(@CurrentUser() user: AuthenticatedUser) {
    return this.affiliates.myReport(user);
  }

  @Get('affiliate/conversions')
  @ApiOperation({ summary: 'Orders attributed to me and their commission' })
  @ApiOkResponse({ schema: zodToOpenApi(affiliateConversionListSchema) })
  conversions(@CurrentUser() user: AuthenticatedUser, @Query() query: ConversionQueryDto) {
    return this.affiliates.myConversions(user, query);
  }

  @Get('affiliate/payouts')
  @ApiOperation({ summary: 'Payouts recorded for me' })
  @ApiOkResponse({ schema: zodToOpenApi(affiliatePayoutListSchema) })
  payouts(@CurrentUser() user: AuthenticatedUser) {
    return this.affiliates.myPayouts(user);
  }
}

@ApiTags('Storefront')
@Controller({ path: 'storefront', version: '1' })
export class StorefrontEngagementController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Post('affiliate-clicks')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Record a visit through an affiliate link' })
  click(@Body() body: ClickDto, @ReqContext() context: RequestContext) {
    return this.affiliates.click(body, context);
  }
}

// ---- Everyone signed in: notifications ------------------------------------------------------

@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationCenterController {
  constructor(private readonly center: NotificationCenterService) {}

  @Get()
  @ApiOperation({ summary: 'My in-app notifications, newest first (with the unread count)' })
  @ApiOkResponse({ schema: zodToOpenApi(notificationListSchema) })
  inbox(@CurrentUser() user: AuthenticatedUser, @Query() query: NotificationQueryDto) {
    return this.center.inbox(user, query);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notifications read (some, or all)' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Body() body: MarkReadDto) {
    return this.center.markRead(user, body);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Which channels I receive (the inbox is always on)' })
  @ApiOkResponse({ schema: zodToOpenApi(notificationPreferencesSchema) })
  preferences(@CurrentUser() user: AuthenticatedUser) {
    return this.center.preferences(user);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Turn email, SMS or push on or off' })
  @ApiOkResponse({ schema: zodToOpenApi(notificationPreferencesSchema) })
  savePreferences(@CurrentUser() user: AuthenticatedUser, @Body() body: PreferencesDto) {
    return this.center.savePreferences(user, body);
  }

  @Post('push-subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register this browser for push notifications (Web Push)' })
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PushDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.center.subscribePush(user, body, context);
  }

  @Delete('push-subscriptions')
  @ApiOperation({ summary: 'Stop push notifications on this browser' })
  unsubscribe(@CurrentUser() user: AuthenticatedUser, @Body() body: UnsubscribeDto) {
    return this.center.unsubscribePush(user, body.endpoint);
  }
}

// ---- Staff ---------------------------------------------------------------------------------

@ApiTags('Loyalty and referrals (staff)')
@Controller({ version: '1' })
export class LoyaltyAdminController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('settings/loyalty')
  @RequirePermissions('loyalty.manage')
  @ApiOkResponse({ schema: zodToOpenApi(loyaltySettingsSchema) })
  settings() {
    return this.loyalty.loyaltySettings();
  }

  @Put('settings/loyalty')
  @RequirePermissions('loyalty.manage')
  @ApiOperation({ summary: 'Earning, value, redeem cap, expiry and referral bonuses' })
  @ApiOkResponse({ schema: zodToOpenApi(loyaltySettingsSchema) })
  saveSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: LoyaltySettingsDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.loyalty.saveSettings('loyalty', body, user, context);
  }

  @Get('loyalty/accounts')
  @RequirePermissions('loyalty.manage')
  @ApiOkResponse({ schema: zodToOpenApi(adminLoyaltyAccountListSchema) })
  accounts(@Query() query: AccountsQueryDto) {
    return this.loyalty.accounts(query);
  }

  @Get('loyalty/accounts/:userId')
  @RequirePermissions('loyalty.manage')
  @ApiOkResponse({ schema: zodToOpenApi(adminLoyaltyAccountSchema) })
  account(@Id('userId') userId: string) {
    return this.loyalty.account(userId);
  }

  @Get('loyalty/accounts/:userId/transactions')
  @RequirePermissions('loyalty.manage')
  @ApiOkResponse({ schema: zodToOpenApi(loyaltyTransactionListSchema) })
  transactions(@Id('userId') userId: string, @Query() query: LoyaltyTxQueryDto) {
    return this.loyalty.transactions(userId, query);
  }

  @Post('loyalty/accounts/:userId/adjustments')
  @RequirePermissions('loyalty.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add or take away points with a reason (posted to the ledger)' })
  @ApiOkResponse({ schema: zodToOpenApi(adminLoyaltyAccountSchema) })
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Id('userId') userId: string,
    @Body() body: AdjustmentDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.loyalty.adjust(user, userId, body, context);
  }
}

@ApiTags('Affiliates (staff)')
@Controller({ version: '1' })
@RequirePermissions('affiliates.manage')
export class AffiliatesAdminController {
  constructor(
    private readonly affiliates: AffiliatesService,
    private readonly loyalty: LoyaltyService,
  ) {}

  @Get('settings/affiliates')
  @ApiOkResponse({ schema: zodToOpenApi(affiliateSettingsSchema) })
  settings() {
    return this.loyalty.affiliateSettings();
  }

  @Put('settings/affiliates')
  @ApiOperation({ summary: 'Default commission rate, link window and minimum payout' })
  @ApiOkResponse({ schema: zodToOpenApi(affiliateSettingsSchema) })
  saveSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AffiliateSettingsDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.loyalty.saveSettings('affiliates', body, user, context);
  }

  @Get('affiliates')
  @ApiOkResponse({ schema: zodToOpenApi(affiliateAccountListSchema) })
  list(@Query() query: AffiliateListQueryDto) {
    return this.affiliates.list(query);
  }

  @Get('affiliates/:id')
  @ApiOkResponse({ schema: zodToOpenApi(affiliateAccountSchema) })
  get(@Id() id: string) {
    return this.affiliates.get(id);
  }

  @Patch('affiliates/:id')
  @ApiOperation({ summary: 'Approve, suspend or reject; set an own commission rate' })
  @ApiOkResponse({ schema: zodToOpenApi(affiliateAccountSchema) })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: ReviewAffiliateDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.affiliates.review(user, id, body, context);
  }

  @Get('affiliates/:id/report')
  @ApiOkResponse({ schema: zodToOpenApi(affiliateReportSchema) })
  report(@Id() id: string) {
    return this.affiliates.report(id);
  }

  @Get('affiliates/:id/conversions')
  @ApiOkResponse({ schema: zodToOpenApi(affiliateConversionListSchema) })
  conversions(@Id() id: string, @Query() query: ConversionQueryDto) {
    return this.affiliates.conversions(id, query);
  }

  @Get('affiliates/:id/payouts')
  @ApiOkResponse({ schema: zodToOpenApi(affiliatePayoutListSchema) })
  payouts(@Id() id: string) {
    return this.affiliates.payouts(id);
  }

  @Post('affiliates/:id/payouts')
  @ApiOperation({ summary: 'Record a manual payout of everything payable (posted to the ledger)' })
  @ApiOkResponse({ schema: zodToOpenApi(affiliatePayoutSchema) })
  recordPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Id() id: string,
    @Body() body: PayoutDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.affiliates.recordPayout(user, id, body, context);
  }
}

@ApiTags('Notifications (staff)')
@Controller({ version: '1' })
@RequirePermissions('notifications.manage')
export class NotificationAdminController {
  constructor(private readonly center: NotificationCenterService) {}

  @Get('notification-templates')
  @ApiOkResponse({ schema: zodToOpenApi(notificationTemplateListSchema) })
  templates() {
    return this.center.templates();
  }

  @Put('notification-templates/:event/:channel')
  @ApiOperation({ summary: 'Create or change the template of an event on a channel' })
  @ApiOkResponse({ schema: zodToOpenApi(notificationTemplateSchema) })
  saveTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('event', new ZodValidationPipe(z.string().regex(/^[A-Z_]{3,60}$/))) event: string,
    @Param('channel', new ZodValidationPipe(channelSchema)) channel: z.infer<typeof channelSchema>,
    @Body() body: TemplateDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.center.saveTemplate(user, event, channel, body, context);
  }

  @Get('notification-deliveries')
  @ApiOperation({ summary: 'Delivery log (destinations masked)' })
  @ApiOkResponse({ schema: zodToOpenApi(notificationDeliveryListSchema) })
  deliveries(@Query() query: DeliveryQueryDto) {
    return this.center.deliveries(query);
  }
}
