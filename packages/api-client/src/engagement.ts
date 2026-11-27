import {
  activeCampaignListSchema,
  adminLoyaltyAccountListSchema,
  adminLoyaltyAccountSchema,
  type AffiliateApplication,
  affiliateAccountListSchema,
  affiliateAccountSchema,
  affiliateConversionListSchema,
  affiliatePayoutListSchema,
  affiliatePayoutSchema,
  affiliateReportSchema,
  type AffiliateSettings,
  affiliateSettingsSchema,
  type CampaignInput,
  campaignListSchema,
  campaignSchema,
  type LoyaltyAdjustmentRequest,
  type LoyaltySettings,
  loyaltySettingsSchema,
  loyaltySummarySchema,
  loyaltyTransactionListSchema,
  myReferralsSchema,
  notificationDeliveryListSchema,
  notificationListSchema,
  notificationPreferencesSchema,
  notificationTemplateListSchema,
  notificationTemplateSchema,
  type RecordAffiliatePayoutRequest,
  reportSchema,
  type ReportQuery,
  type ReportReviewRequest,
  type ResolveReviewReportsRequest,
  type ReviewAffiliateRequest,
  type ReviewReplyRequest,
  adminReviewListSchema,
  adminReviewSchema,
  myReviewsSchema,
  reviewReportSchema,
  sellerRatingSchema,
  type SellerRatingInput,
  sellerRatingSummarySchema,
  type TicketActionRequest,
  type CreateTicketRequest,
  ticketDetailSchema,
  ticketListSchema,
  type UpdateCampaignRequest,
  type UpdateNotificationPreferencesRequest,
  type UpsertNotificationTemplateRequest,
} from '@marketplace/validation';
import { z } from 'zod';
import type { RequestOptions } from './client';

type Request = <TSchema extends z.ZodType>(
  path: string,
  options: RequestOptions<TSchema>,
) => Promise<z.output<TSchema>>;
export type EngagementQuery = Record<string, string | number | boolean | undefined>;

const id = (value: string) => encodeURIComponent(value);
const asQuery = (value: object) =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ''),
  ) as Record<string, string | number | boolean>;
const ok = z.unknown();
const blob = z.instanceof(Blob);

/** Phase 7: campaigns, loyalty, referrals, affiliates, reviews, support, notifications, reports. */
export function createEngagementClient(request: Request) {
  const get = <T extends z.ZodType>(
    path: string,
    schema: T,
    query?: object,
    signal?: AbortSignal,
  ) => request(path, { schema, query: query ? asQuery(query) : undefined, signal });
  const send = <T extends z.ZodType>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    schema: T,
    body: unknown = {},
  ) => request(path, { method, body, schema });
  const withFiles = (data: unknown, files: File[], field: string) => {
    const form = new FormData();
    form.append('data', JSON.stringify(data));
    for (const file of files) form.append(field, file);
    return form;
  };
  const tickets = (base: string) => ({
    list: (query: EngagementQuery, signal?: AbortSignal) =>
      get(base, ticketListSchema, query, signal),
    get: (ticketId: string, signal?: AbortSignal) =>
      get(`${base}/${id(ticketId)}`, ticketDetailSchema, undefined, signal),
    reply: (ticketId: string, body: { body: string; internal?: boolean }, files: File[] = []) =>
      request(`${base}/${id(ticketId)}/messages`, {
        method: 'POST',
        body: withFiles(body, files, 'attachments'),
        schema: ticketDetailSchema,
      }),
    act: (ticketId: string, body: TicketActionRequest) =>
      send('POST', `${base}/${id(ticketId)}/actions`, ticketDetailSchema, body),
    attachment: (ticketId: string, attachmentId: string): Promise<Blob> =>
      request(`${base}/${id(ticketId)}/attachments/${id(attachmentId)}`, {
        schema: blob,
        responseType: 'blob',
      }),
  });
  const reportExport =
    (base: string) =>
    (name: string, query: ReportQuery & { format: 'csv' | 'xlsx' | 'pdf' }): Promise<Blob> =>
      request(`${base}/${id(name)}/export`, {
        query: asQuery(query),
        schema: blob,
        responseType: 'blob',
      });

  return {
    storefront: {
      campaigns: (storeId?: string, signal?: AbortSignal) =>
        get('/storefront/campaigns', activeCampaignListSchema, { storeId }, signal),
      affiliateClick: (code: string, landingPath: string) =>
        send('POST', '/storefront/affiliate-clicks', ok, { code, landingPath }),
      storeRatings: (storeId: string, signal?: AbortSignal) =>
        get(`/catalog/stores/${id(storeId)}/ratings`, sellerRatingSummarySchema, undefined, signal),
      reportReview: (reviewId: string, body: ReportReviewRequest) =>
        send('POST', `/catalog/reviews/${id(reviewId)}/report`, ok, body),
    },
    account: {
      loyalty: (signal?: AbortSignal) =>
        get('/account/loyalty', loyaltySummarySchema, undefined, signal),
      loyaltyTransactions: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/account/loyalty/transactions', loyaltyTransactionListSchema, query, signal),
      referrals: (signal?: AbortSignal) =>
        get('/account/referrals', myReferralsSchema, undefined, signal),
      affiliate: (signal?: AbortSignal) =>
        get('/account/affiliate', affiliateAccountSchema, undefined, signal),
      applyAffiliate: (body: AffiliateApplication) =>
        send('POST', '/account/affiliate', affiliateAccountSchema, body),
      affiliateReport: (signal?: AbortSignal) =>
        get('/account/affiliate/report', affiliateReportSchema, undefined, signal),
      affiliateConversions: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/account/affiliate/conversions', affiliateConversionListSchema, query, signal),
      reviewImages: (reviewId: string, files: File[]) => {
        const form = new FormData();
        for (const file of files) form.append('images', file);
        return request(`/account/reviews/${id(reviewId)}/images`, {
          method: 'POST',
          body: form,
          schema: myReviewsSchema,
        });
      },
      removeReviewImage: (reviewId: string, imageId: string) =>
        send('DELETE', `/account/reviews/${id(reviewId)}/images/${id(imageId)}`, myReviewsSchema),
      rateSeller: (sellerOrderId: string, body: SellerRatingInput) =>
        send('PUT', `/account/seller-orders/${id(sellerOrderId)}/rating`, sellerRatingSchema, body),
      openTicket: (body: CreateTicketRequest, files: File[] = []) =>
        request('/account/support/tickets', {
          method: 'POST',
          body: withFiles(body, files, 'attachments'),
          schema: ticketDetailSchema,
        }),
      tickets: tickets('/account/support/tickets'),
    },
    notifications: {
      list: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/notifications', notificationListSchema, query, signal),
      markRead: (body: { ids?: string[]; all?: boolean }) =>
        send('POST', '/notifications/read', ok, body),
      preferences: (signal?: AbortSignal) =>
        get('/notifications/preferences', notificationPreferencesSchema, undefined, signal),
      savePreferences: (body: UpdateNotificationPreferencesRequest) =>
        send('PUT', '/notifications/preferences', notificationPreferencesSchema, body),
    },
    seller: {
      campaigns: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/seller/campaigns', campaignListSchema, query, signal),
      createCampaign: (body: CampaignInput) =>
        send('POST', '/seller/campaigns', campaignSchema, body),
      updateCampaign: (campaignId: string, body: UpdateCampaignRequest) =>
        send('PATCH', `/seller/campaigns/${id(campaignId)}`, campaignSchema, body),
      reviews: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/seller/reviews', adminReviewListSchema, query, signal),
      reply: (reviewId: string, body: ReviewReplyRequest) =>
        send('PUT', `/seller/reviews/${id(reviewId)}/reply`, adminReviewSchema, body),
      removeReply: (reviewId: string) =>
        send('DELETE', `/seller/reviews/${id(reviewId)}/reply`, adminReviewSchema),
      ratings: (signal?: AbortSignal) =>
        get(
          '/seller/ratings',
          z.object({
            summary: sellerRatingSummarySchema,
            recent: z.array(sellerRatingSchema.extend({ sellerOrderNumber: z.string() })),
          }),
          undefined,
          signal,
        ),
      tickets: tickets('/seller/support/tickets'),
      report: (name: string, query: ReportQuery, signal?: AbortSignal) =>
        get(`/seller/reports/${id(name)}`, reportSchema, query, signal),
      exportReport: reportExport('/seller/reports'),
    },
    admin: {
      campaigns: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/campaigns', campaignListSchema, query, signal),
      createCampaign: (body: CampaignInput) => send('POST', '/campaigns', campaignSchema, body),
      updateCampaign: (campaignId: string, body: UpdateCampaignRequest) =>
        send('PATCH', `/campaigns/${id(campaignId)}`, campaignSchema, body),
      loyaltySettings: (signal?: AbortSignal) =>
        get('/settings/loyalty', loyaltySettingsSchema, undefined, signal),
      saveLoyaltySettings: (body: LoyaltySettings) =>
        send('PUT', '/settings/loyalty', loyaltySettingsSchema, body),
      affiliateSettings: (signal?: AbortSignal) =>
        get('/settings/affiliates', affiliateSettingsSchema, undefined, signal),
      saveAffiliateSettings: (body: AffiliateSettings) =>
        send('PUT', '/settings/affiliates', affiliateSettingsSchema, body),
      loyaltyAccounts: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/loyalty/accounts', adminLoyaltyAccountListSchema, query, signal),
      loyaltyAccount: (userId: string, signal?: AbortSignal) =>
        get(`/loyalty/accounts/${id(userId)}`, adminLoyaltyAccountSchema, undefined, signal),
      loyaltyTransactions: (userId: string, query: EngagementQuery, signal?: AbortSignal) =>
        get(
          `/loyalty/accounts/${id(userId)}/transactions`,
          loyaltyTransactionListSchema,
          query,
          signal,
        ),
      adjustPoints: (userId: string, body: LoyaltyAdjustmentRequest) =>
        send(
          'POST',
          `/loyalty/accounts/${id(userId)}/adjustments`,
          adminLoyaltyAccountSchema,
          body,
        ),
      affiliates: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/affiliates', affiliateAccountListSchema, query, signal),
      reviewAffiliate: (affiliateId: string, body: ReviewAffiliateRequest) =>
        send('PATCH', `/affiliates/${id(affiliateId)}`, affiliateAccountSchema, body),
      affiliateConversions: (affiliateId: string, query: EngagementQuery, signal?: AbortSignal) =>
        get(
          `/affiliates/${id(affiliateId)}/conversions`,
          affiliateConversionListSchema,
          query,
          signal,
        ),
      affiliatePayouts: (affiliateId: string, signal?: AbortSignal) =>
        get(`/affiliates/${id(affiliateId)}/payouts`, affiliatePayoutListSchema, undefined, signal),
      recordAffiliatePayout: (affiliateId: string, body: RecordAffiliatePayoutRequest) =>
        send('POST', `/affiliates/${id(affiliateId)}/payouts`, affiliatePayoutSchema, body),
      reviewReports: (reviewId: string, signal?: AbortSignal) =>
        get(
          `/reviews/${id(reviewId)}/reports`,
          z.object({ items: z.array(reviewReportSchema) }),
          undefined,
          signal,
        ),
      resolveReviewReports: (reviewId: string, body: ResolveReviewReportsRequest) =>
        send('POST', `/reviews/${id(reviewId)}/reports/resolve`, ok, body),
      templates: (signal?: AbortSignal) =>
        get('/notification-templates', notificationTemplateListSchema, undefined, signal),
      saveTemplate: (event: string, channel: string, body: UpsertNotificationTemplateRequest) =>
        send(
          'PUT',
          `/notification-templates/${id(event)}/${id(channel)}`,
          notificationTemplateSchema,
          body,
        ),
      deliveries: (query: EngagementQuery, signal?: AbortSignal) =>
        get('/notification-deliveries', notificationDeliveryListSchema, query, signal),
      tickets: tickets('/support/tickets'),
      report: (name: string, query: ReportQuery, signal?: AbortSignal) =>
        get(`/reports/${id(name)}`, reportSchema, query, signal),
      exportReport: reportExport('/reports'),
    },
  };
}
