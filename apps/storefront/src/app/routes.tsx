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
import { AccountPage } from '../pages/account/account-page';
import { SignInPage } from '../pages/auth/sign-in-page';
import { SignUpPage } from '../pages/auth/sign-up-page';
import { VerifyEmailPage } from '../pages/auth/verify-email-page';
import { HomePage } from '../pages/home-page';
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
          {
            element: <RequireSession />,
            children: [{ path: 'account', element: <AccountPage /> }],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];
