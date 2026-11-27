import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  RedirectIfSignedIn,
  RequirePermission,
  RequireSession,
  ResetPasswordPage,
  StaffSignInPage,
  VerifyEmailPage,
} from '@marketplace/auth-ui';
import { NotFound, RouteError } from '@marketplace/ui';
import { Link, Navigate, type RouteObject } from 'react-router';
import { SellerBrand } from '../components/brand';
import { AccountPage } from '../pages/account/account-page';
import { JoinPage } from '../pages/auth/join-page';
import { RegisterPage } from '../pages/auth/register-page';
import { DashboardPage } from '../pages/dashboard/dashboard-page';
import { EmployeesPage } from '../pages/employees/employees-page';
import { AdjustmentsPage } from '../pages/inventory/adjustments-page';
import { HistoryPage } from '../pages/inventory/history-page';
import { InventoryPage } from '../pages/inventory/inventory-page';
import { WarehousesPage } from '../pages/inventory/warehouses-page';
import {
  SellerCampaignsPage,
  SellerReportsPage,
  SellerReviewsPage,
  SellerSupportPage,
  SellerTicketPage,
} from '../pages/engagement/engagement-pages';
import { SellerCouponsPage, SellerFlashSalesPage } from '../pages/marketing/marketing-pages';
import { OrderPage, OrdersPage } from '../pages/orders/orders-page';
import {
  BankAccountsPage,
  DocumentPage,
  DocumentsPage,
  FinanceOverviewPage,
  PayoutPage,
  PayoutsPage,
  SettlementPage,
  SettlementsPage,
  TaxProfilePage,
  TransactionsPage,
} from '../pages/finance/finance-pages';
import { ReturnPage, ReturnsPage } from '../pages/orders/returns-page';
import { NewProductPage } from '../pages/products/new-product-page';
import { ProductPage } from '../pages/products/product-page';
import { ProductsPage } from '../pages/products/products-page';
import { ProfilePage } from '../pages/profile/profile-page';
import { StatusPage } from '../pages/status-page';
import { StoreDetailPage } from '../pages/stores/store-detail-page';
import { StoresPage } from '../pages/stores/stores-page';
import { VerificationPage } from '../pages/verification/verification-page';
import { SellerLayout } from './seller-layout';

const brand = <SellerBrand />;

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      {
        path: '/sign-in',
        element: (
          <RedirectIfSignedIn>
            <StaffSignInPage
              brand={brand}
              appName="the Seller Center"
              description="Sign in with the account you used to register your business, or the one your employer invited."
              footer={
                <p className="text-center text-sm text-muted-foreground">
                  New seller?{' '}
                  <Link
                    to="/register"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Register your business
                  </Link>
                </p>
              }
            />
          </RedirectIfSignedIn>
        ),
      },
      {
        path: '/register',
        element: (
          <RedirectIfSignedIn to="/verification">
            <RegisterPage />
          </RedirectIfSignedIn>
        ),
      },
      { path: '/join', element: <JoinPage /> },
      {
        path: '/verify-email',
        element: <VerifyEmailPage brand={brand} accountPath="/dashboard" signInPath="/sign-in" />,
      },
      { path: '/forgot-password', element: <ForgotPasswordPage brand={brand} /> },
      { path: '/reset-password', element: <ResetPasswordPage brand={brand} /> },
      { path: '/accept-invitation', element: <AcceptInvitationPage brand={brand} /> },
      {
        element: <RequireSession />,
        children: [
          {
            path: '/',
            element: <SellerLayout />,
            children: [
              { index: true, element: <Navigate to="/dashboard" replace /> },
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: 'verification', element: <VerificationPage /> },
              { path: 'stores', element: <StoresPage /> },
              { path: 'stores/:storeId', element: <StoreDetailPage /> },
              {
                path: 'employees',
                element: (
                  <RequirePermission permission="seller.members.read">
                    <EmployeesPage />
                  </RequirePermission>
                ),
              },
              { path: 'products', element: <ProductsPage /> },
              {
                path: 'products/new',
                element: (
                  <RequirePermission permission="seller.products.manage">
                    <NewProductPage />
                  </RequirePermission>
                ),
              },
              { path: 'products/:productId', element: <ProductPage /> },
              { path: 'inventory', element: <InventoryPage /> },
              { path: 'inventory/warehouses', element: <WarehousesPage /> },
              {
                path: 'inventory/adjustments',
                element: (
                  <RequirePermission permission="seller.inventory.manage">
                    <AdjustmentsPage />
                  </RequirePermission>
                ),
              },
              { path: 'inventory/history', element: <HistoryPage /> },
              {
                path: 'orders',
                element: (
                  <RequirePermission permission="seller.orders.read">
                    <OrdersPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'orders/:orderId',
                element: (
                  <RequirePermission permission="seller.orders.read">
                    <OrderPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'returns',
                element: (
                  <RequirePermission permission="seller.orders.read">
                    <ReturnsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'returns/:returnId',
                element: (
                  <RequirePermission permission="seller.orders.read">
                    <ReturnPage />
                  </RequirePermission>
                ),
              },
              { path: 'marketing/campaigns', element: <SellerCampaignsPage /> },
              { path: 'reviews', element: <SellerReviewsPage /> },
              {
                path: 'support',
                element: (
                  <RequirePermission permission="seller.support.manage">
                    <SellerSupportPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'support/:ticketId',
                element: (
                  <RequirePermission permission="seller.support.manage">
                    <SellerTicketPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'reports',
                element: (
                  <RequirePermission permission="seller.reports.read">
                    <SellerReportsPage />
                  </RequirePermission>
                ),
              },
              // Phase 5 payables page: now the finance transactions (double-entry ledger).
              { path: 'payables', element: <Navigate to="/finance/transactions" replace /> },
              {
                path: 'finance',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <FinanceOverviewPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/transactions',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <TransactionsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/settlements',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <SettlementsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/settlements/:settlementId',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <SettlementPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/documents',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <DocumentsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/documents/:documentId',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <DocumentPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/payouts',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <PayoutsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/payouts/:payoutId',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <PayoutPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/bank-accounts',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <BankAccountsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'finance/tax',
                element: (
                  <RequirePermission permission="seller.finance.read">
                    <TaxProfilePage />
                  </RequirePermission>
                ),
              },
              { path: 'marketing/coupons', element: <SellerCouponsPage /> },
              { path: 'marketing/flash-sales', element: <SellerFlashSalesPage /> },
              { path: 'account', element: <AccountPage /> },
              { path: 'system-status', element: <StatusPage /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];
