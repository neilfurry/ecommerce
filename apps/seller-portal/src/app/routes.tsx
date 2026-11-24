import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  RedirectIfSignedIn,
  RequireSession,
  ResetPasswordPage,
  StaffSignInPage,
} from '@marketplace/auth-ui';
import { APP_NAME } from '@marketplace/config';
import { BrandMark, NotFound, RouteError } from '@marketplace/ui';
import { StoreIcon } from 'lucide-react';
import { Navigate, type RouteObject } from 'react-router';
import { StatusPage } from '../pages/status-page';
import { SellerLayout } from './seller-layout';

const brand = (
  <>
    <BrandMark icon={StoreIcon} />
    <span>{APP_NAME} Seller Center</span>
  </>
);

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      {
        path: '/sign-in',
        element: (
          <RedirectIfSignedIn>
            <StaffSignInPage brand={brand} appName="the Seller Center" />
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
            element: <SellerLayout />,
            children: [
              { index: true, element: <Navigate to="/system-status" replace /> },
              { path: 'system-status', element: <StatusPage /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];
