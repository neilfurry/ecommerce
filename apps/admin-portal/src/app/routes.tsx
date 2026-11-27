import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  RedirectIfSignedIn,
  RequirePermission,
  RequireSession,
  ResetPasswordPage,
  StaffSignInPage,
} from '@marketplace/auth-ui';
import { APP_NAME } from '@marketplace/config';
import type { Permission } from '@marketplace/shared-types';
import { BrandMark, NotFound, RouteError } from '@marketplace/ui';
import { ShieldCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { DEV_TOOLS_UI_ENABLED } from '../lib/env';
import { AuditLogPage } from '../pages/audit/audit-log-page';
import { FilesPage } from '../pages/dev-tools/files-page';
import { JobsPage } from '../pages/dev-tools/jobs-page';
import { SmsOutboxPage } from '../pages/dev-tools/sms-outbox-page';
import { BrandsPage } from '../pages/catalog/brands-page';
import { CategoriesPage } from '../pages/catalog/categories-page';
import { ProductReviewPage } from '../pages/catalog/product-review-page';
import { AdminProductsPage } from '../pages/catalog/products-page';
import { InventoryOverviewPage } from '../pages/inventory/inventory-overview-page';
import {
  AffiliatesPage,
  AnalyticsPage,
  CampaignsPage,
  LoyaltyPage,
  NotificationsPage,
  SupportTicketPage,
  SupportTicketsPage,
} from '../pages/engagement/engagement-pages';
import { PromotionsPage } from '../pages/marketing/promotions-page';
import { ReviewsPage } from '../pages/marketing/reviews-page';
import { StorefrontContentPage } from '../pages/marketing/storefront-content-page';
import {
  AdminOrderPage,
  AdminOrdersPage,
  AdminSellerOrderPage,
} from '../pages/orders/orders-pages';
import { SettingsPage } from '../pages/settings/settings-page';
import {
  BankTransfersPage,
  CodPage,
  PaymentPage,
  PaymentsPage,
  ReconciliationPage,
  RefundsPage,
} from '../pages/finance/finance-pages';
import {
  DocumentAdminPage,
  DocumentsAdminPage,
  FinanceDashboardPage,
  FinanceSettingsPage,
  PayoutAdminPage,
  PayoutsAdminPage,
  SellerBalancesPage,
  SellerFinancePage,
  SettlementAdminPage,
  SettlementsAdminPage,
} from '../pages/finance/finance-admin-pages';
import {
  AccountLedgerPage,
  CommissionRulesPage,
  ExpensesPage,
  JournalPage,
  LedgerPage,
  ReportsPage,
  TaxesPage,
} from '../pages/finance/ledger-pages';
import { DisputePage, DisputesPage, ShippingPage } from '../pages/fulfilment/fulfilment-pages';
import { PermissionsPage } from '../pages/permissions/permissions-page';
import { RolesPage } from '../pages/roles/roles-page';
import { SellerDetailPage } from '../pages/sellers/seller-detail-page';
import { SellersPage } from '../pages/sellers/sellers-page';
import { StatusPage } from '../pages/status-page';
import { StoresPage } from '../pages/stores/stores-page';
import { UserDetailPage } from '../pages/users/user-detail-page';
import { UsersPage } from '../pages/users/users-page';
import { WholesalePage } from '../pages/wholesale/wholesale-page';
import { AdminLayout, HomeRedirect } from './admin-layout';

const brand = (
  <>
    <BrandMark icon={ShieldCheckIcon} className="bg-foreground text-background" />
    <span>{APP_NAME} Admin Console</span>
  </>
);

const guarded = (permission: Permission, page: ReactNode) => (
  <RequirePermission permission={permission}>{page}</RequirePermission>
);

export function buildRoutes(devToolsEnabled: boolean): RouteObject[] {
  return [
    {
      errorElement: <RouteError />,
      children: [
        {
          path: '/sign-in',
          element: (
            <RedirectIfSignedIn>
              <StaffSignInPage brand={brand} appName="the Admin Console" />
            </RedirectIfSignedIn>
          ),
        },
        { path: '/forgot-password', element: <ForgotPasswordPage brand={brand} /> },
        { path: '/reset-password', element: <ResetPasswordPage brand={brand} /> },
        { path: '/accept-invitation', element: <AcceptInvitationPage brand={brand} /> },
        {
          element: <RequireSession />,
          children: [
            {
              path: '/',
              element: <AdminLayout devToolsEnabled={devToolsEnabled} />,
              children: [
                { index: true, element: <HomeRedirect /> },
                { path: 'system-health', element: <StatusPage /> },
                { path: 'users', element: guarded('users.read', <UsersPage />) },
                { path: 'users/:userId', element: guarded('users.read', <UserDetailPage />) },
                { path: 'wholesale', element: guarded('wholesale.read', <WholesalePage />) },
                { path: 'sellers', element: guarded('sellers.read', <SellersPage />) },
                {
                  path: 'sellers/:sellerId',
                  element: guarded('sellers.read', <SellerDetailPage />),
                },
                { path: 'stores', element: guarded('stores.read', <StoresPage />) },
                {
                  path: 'catalog/products',
                  element: guarded('catalog.products.read', <AdminProductsPage />),
                },
                {
                  path: 'catalog/products/:productId',
                  element: guarded('catalog.products.read', <ProductReviewPage />),
                },
                {
                  path: 'catalog/categories',
                  element: guarded('catalog.categories.manage', <CategoriesPage />),
                },
                {
                  path: 'catalog/brands',
                  element: guarded('catalog.brands.manage', <BrandsPage />),
                },
                {
                  path: 'inventory',
                  element: guarded('inventory.read', <InventoryOverviewPage />),
                },
                { path: 'orders', element: guarded('orders.read', <AdminOrdersPage />) },
                {
                  path: 'orders/:orderId',
                  element: guarded('orders.read', <AdminOrderPage />),
                },
                {
                  path: 'seller-orders/:orderId',
                  element: guarded('orders.read', <AdminSellerOrderPage />),
                },
                { path: 'payments', element: guarded('payments.read', <PaymentsPage />) },
                { path: 'payments/:paymentId', element: guarded('payments.read', <PaymentPage />) },
                {
                  path: 'bank-transfers',
                  element: guarded('payments.read', <BankTransfersPage />),
                },
                { path: 'cod', element: guarded('payments.read', <CodPage />) },
                { path: 'refunds', element: guarded('payments.read', <RefundsPage />) },
                {
                  path: 'reconciliation',
                  element: guarded('payments.read', <ReconciliationPage />),
                },
                { path: 'finance', element: guarded('finance.read', <FinanceDashboardPage />) },
                {
                  path: 'finance/commission',
                  element: guarded('finance.read', <CommissionRulesPage />),
                },
                { path: 'finance/taxes', element: guarded('finance.read', <TaxesPage />) },
                {
                  path: 'finance/balances',
                  element: guarded('finance.read', <SellerBalancesPage />),
                },
                {
                  path: 'finance/balances/:sellerId',
                  element: guarded('finance.read', <SellerFinancePage />),
                },
                {
                  path: 'finance/settlements',
                  element: guarded('finance.read', <SettlementsAdminPage />),
                },
                {
                  path: 'finance/settlements/:settlementId',
                  element: guarded('finance.read', <SettlementAdminPage />),
                },
                { path: 'finance/payouts', element: guarded('finance.read', <PayoutsAdminPage />) },
                {
                  path: 'finance/payouts/:payoutId',
                  element: guarded('finance.read', <PayoutAdminPage />),
                },
                { path: 'finance/ledger', element: guarded('finance.read', <LedgerPage />) },
                {
                  path: 'finance/journals/:journalId',
                  element: guarded('finance.read', <JournalPage />),
                },
                {
                  path: 'finance/accounts/:code',
                  element: guarded('finance.read', <AccountLedgerPage />),
                },
                { path: 'finance/expenses', element: guarded('finance.read', <ExpensesPage />) },
                { path: 'finance/reports', element: guarded('finance.read', <ReportsPage />) },
                {
                  path: 'finance/documents',
                  element: guarded('finance.read', <DocumentsAdminPage />),
                },
                {
                  path: 'finance/documents/:documentId',
                  element: guarded('finance.read', <DocumentAdminPage />),
                },
                {
                  path: 'finance/settings',
                  element: guarded('finance.read', <FinanceSettingsPage />),
                },
                { path: 'shipping', element: guarded('orders.read', <ShippingPage />) },
                { path: 'disputes', element: guarded('orders.read', <DisputesPage />) },
                { path: 'disputes/:returnId', element: guarded('orders.read', <DisputePage />) },
                {
                  path: 'storefront',
                  element: guarded('marketing.manage', <StorefrontContentPage />),
                },
                {
                  path: 'promotions',
                  element: guarded('marketing.manage', <PromotionsPage />),
                },
                { path: 'reviews', element: guarded('reviews.moderate', <ReviewsPage />) },
                { path: 'analytics', element: guarded('reports.read', <AnalyticsPage />) },
                { path: 'campaigns', element: guarded('marketing.manage', <CampaignsPage />) },
                { path: 'loyalty', element: guarded('loyalty.manage', <LoyaltyPage />) },
                { path: 'affiliates', element: guarded('affiliates.manage', <AffiliatesPage />) },
                { path: 'support', element: guarded('support.read', <SupportTicketsPage />) },
                {
                  path: 'support/:ticketId',
                  element: guarded('support.read', <SupportTicketPage />),
                },
                {
                  path: 'notifications',
                  element: guarded('notifications.manage', <NotificationsPage />),
                },
                { path: 'settings', element: guarded('settings.manage', <SettingsPage />) },
                { path: 'roles', element: guarded('roles.read', <RolesPage />) },
                { path: 'permissions', element: guarded('roles.read', <PermissionsPage />) },
                { path: 'audit-log', element: guarded('audit.read', <AuditLogPage />) },
                ...(devToolsEnabled
                  ? [
                      { path: 'dev-tools', element: <Navigate to="/dev-tools/jobs" replace /> },
                      { path: 'dev-tools/jobs', element: guarded('dev-tools.use', <JobsPage />) },
                      { path: 'dev-tools/files', element: guarded('dev-tools.use', <FilesPage />) },
                      {
                        path: 'dev-tools/sms',
                        element: guarded('dev-tools.use', <SmsOutboxPage />),
                      },
                    ]
                  : []),
                { path: '*', element: <NotFound /> },
              ],
            },
          ],
        },
      ],
    },
  ];
}

export const routes = buildRoutes(DEV_TOOLS_UI_ENABLED);
