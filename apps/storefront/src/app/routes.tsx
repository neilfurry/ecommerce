import {
  ForgotPasswordPage,
  RedirectIfSignedIn,
  RequireSession,
  ResetPasswordPage,
} from '@marketplace/auth-ui';
import { NotFound, RouteError } from '@marketplace/ui';
import type { RouteObject } from 'react-router';
import { StoreBrand } from '../components/store-brand';
import { StoreLayout } from '../layouts/store-layout';
import { AccountLayout } from '../pages/account/account-layout';
import { AddressesPage } from '../pages/account/addresses-page';
import {
  AffiliatePage,
  NotificationsPage,
  RewardsPage,
  SupportPage,
  TicketPage,
} from '../pages/account/engagement-pages';
import { OrderPage } from '../pages/account/order-page';
import { OrdersPage } from '../pages/account/orders-page';
import { AccountOverviewPage } from '../pages/account/overview-page';
import { ReturnPage, ReturnsPage } from '../pages/account/returns-page';
import { ReviewsPage } from '../pages/account/reviews-page';
import { AccountSettingsPage } from '../pages/account/settings-page';
import { WishlistPage } from '../pages/account/wishlist-page';
import { CartPage } from '../pages/shop/cart-page';
import { CategoryPage } from '../pages/shop/category-page';
import { CheckoutPage } from '../pages/shop/checkout-page';
import { ProductPage } from '../pages/shop/product-page';
import { SearchPage } from '../pages/shop/search-page';
import { StorePage } from '../pages/shop/store-page';
import { SignInPage } from '../pages/auth/sign-in-page';
import { SignUpPage } from '../pages/auth/sign-up-page';
import { VerifyEmailPage } from '../pages/auth/verify-email-page';
import { HomePage } from '../pages/home-page';
import { MockPayPage } from '../pages/pay/mock-pay-page';
import { StatusPage } from '../pages/status-page';

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      {
        path: '/sign-in',
        element: (
          <RedirectIfSignedIn to="/account">
            <SignInPage />
          </RedirectIfSignedIn>
        ),
      },
      {
        path: '/sign-up',
        element: (
          <RedirectIfSignedIn to="/account">
            <SignUpPage />
          </RedirectIfSignedIn>
        ),
      },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage brand={<StoreBrand />} /> },
      { path: '/reset-password', element: <ResetPasswordPage brand={<StoreBrand />} /> },
      {
        path: '/',
        element: <StoreLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'status', element: <StatusPage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'c/:slug', element: <CategoryPage /> },
          { path: 'p/:productId/:slug?', element: <ProductPage /> },
          { path: 's/:slug', element: <StorePage /> },
          { path: 'cart', element: <CartPage /> },
          {
            element: <RequireSession />,
            children: [
              { path: 'checkout', element: <CheckoutPage /> },
              { path: 'pay/mock/:sessionId', element: <MockPayPage /> },
              {
                path: 'account',
                element: <AccountLayout />,
                children: [
                  { index: true, element: <AccountOverviewPage /> },
                  { path: 'orders', element: <OrdersPage /> },
                  { path: 'orders/:orderId', element: <OrderPage /> },
                  { path: 'returns', element: <ReturnsPage /> },
                  { path: 'returns/:returnId', element: <ReturnPage /> },
                  { path: 'addresses', element: <AddressesPage /> },
                  { path: 'wishlist', element: <WishlistPage /> },
                  { path: 'reviews', element: <ReviewsPage /> },
                  { path: 'settings', element: <AccountSettingsPage /> },
                  { path: 'rewards', element: <RewardsPage /> },
                  { path: 'loyalty', element: <RewardsPage /> },
                  { path: 'affiliate', element: <AffiliatePage /> },
                  { path: 'support', element: <SupportPage /> },
                  { path: 'support/:ticketId', element: <TicketPage /> },
                  { path: 'notifications', element: <NotificationsPage /> },
                ],
              },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];
