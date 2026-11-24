import { hasPermission, useSession } from '@marketplace/api-client';
import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  RedirectIfSignedIn,
  RequirePermission,
  RequireSession,
  ResetPasswordPage,
  StaffSignInPage,
  UserMenu,
} from '@marketplace/auth-ui';
import { APP_NAME } from '@marketplace/config';
import type { Permission } from '@marketplace/shared-types';
import {
  BrandMark,
  NotFound,
  RouteError,
  SidebarLayout,
  type SidebarNavItem,
  type SidebarNavSection,
} from '@marketplace/ui';
import {
  ActivityIcon,
  BuildingIcon,
  HardDriveIcon,
  KeyRoundIcon,
  ListChecksIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { DEV_TOOLS_UI_ENABLED } from '../lib/env';
import { AuditLogPage } from '../pages/audit/audit-log-page';
import { FilesPage } from '../pages/dev-tools/files-page';
import { JobsPage } from '../pages/dev-tools/jobs-page';
import { SmsOutboxPage } from '../pages/dev-tools/sms-outbox-page';
import { RolesPage } from '../pages/roles/roles-page';
import { StatusPage } from '../pages/status-page';
import { UserDetailPage } from '../pages/users/user-detail-page';
import { UsersPage } from '../pages/users/users-page';
import { WholesalePage } from '../pages/wholesale/wholesale-page';

const brand = (
  <>
    <BrandMark icon={ShieldCheckIcon} className="bg-foreground text-background" />
    <span>{APP_NAME} Admin Console</span>
  </>
);

type NavEntry = SidebarNavItem & { permission?: Permission };

/**
 * Navigation lists only working pages the user may open. Seller approval, catalog
 * moderation, orders, finance and settings are added by the phases that deliver them.
 */
export function buildNavSections(
  devToolsEnabled: boolean,
  permissions: readonly Permission[],
): SidebarNavSection[] {
  const allowed = (items: NavEntry[]) =>
    items.filter((item) => !item.permission || permissions.includes(item.permission));
  const sections: { title: string; items: NavEntry[] }[] = [
    {
      title: 'Platform',
      items: [{ to: '/system-health', label: 'System health', icon: ActivityIcon }],
    },
    {
      title: 'People',
      items: [
        { to: '/users', label: 'Users', icon: UsersIcon, permission: 'users.read' },
        {
          to: '/wholesale',
          label: 'Wholesale approvals',
          icon: BuildingIcon,
          permission: 'wholesale.read',
        },
        {
          to: '/roles',
          label: 'Roles & permissions',
          icon: KeyRoundIcon,
          permission: 'roles.read',
        },
        { to: '/audit-log', label: 'Audit log', icon: ScrollTextIcon, permission: 'audit.read' },
      ],
    },
  ];
  if (devToolsEnabled) {
    sections.push({
      title: 'Developer tools',
      items: [
        {
          to: '/dev-tools/jobs',
          label: 'Background jobs',
          icon: ListChecksIcon,
          permission: 'dev-tools.use',
        },
        {
          to: '/dev-tools/files',
          label: 'File storage',
          icon: HardDriveIcon,
          permission: 'dev-tools.use',
        },
        {
          to: '/dev-tools/sms',
          label: 'SMS outbox',
          icon: MessageSquareIcon,
          permission: 'dev-tools.use',
        },
      ],
    });
  }
  return sections
    .map((section) => ({ title: section.title, items: allowed(section.items) }))
    .filter((section) => section.items.length > 0);
}

function AdminLayout({ devToolsEnabled }: { devToolsEnabled: boolean }) {
  const session = useSession();
  return (
    <SidebarLayout
      appName="Admin Console"
      appTagline={APP_NAME}
      logo={<BrandMark icon={ShieldCheckIcon} className="bg-foreground text-background" />}
      sections={buildNavSections(devToolsEnabled, session.data?.user.permissions ?? [])}
      headerActions={<UserMenu />}
    />
  );
}

const guarded = (permission: Permission, page: ReactNode) => (
  <RequirePermission permission={permission}>{page}</RequirePermission>
);

/** Lands each user on the first page their permissions allow. */
function HomeRedirect() {
  const session = useSession();
  return (
    <Navigate
      to={hasPermission(session.data, 'users.read') ? '/users' : '/system-health'}
      replace
    />
  );
}

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
                { path: 'roles', element: guarded('roles.read', <RolesPage />) },
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
