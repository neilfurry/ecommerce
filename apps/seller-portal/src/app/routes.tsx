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
