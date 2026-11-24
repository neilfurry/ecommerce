import { APP_NAME } from '@marketplace/config';
import {
  BrandMark,
  NotFound,
  RouteError,
  SidebarLayout,
  type SidebarNavSection,
} from '@marketplace/ui';
import { ActivityIcon, StoreIcon } from 'lucide-react';
import { Navigate, type RouteObject } from 'react-router';
import { StatusPage } from '../pages/status-page';

/**
 * Navigation lists only working pages. Store, product, inventory and order sections are
 * added by the phases that deliver them (sign-in arrives in Phase 2).
 */
export const NAV_SECTIONS: SidebarNavSection[] = [
  {
    title: 'Support',
    items: [{ to: '/system-status', label: 'System status', icon: ActivityIcon }],
  },
];

export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <SidebarLayout
        appName="Seller Center"
        appTagline={APP_NAME}
        logo={<BrandMark icon={StoreIcon} />}
        sections={NAV_SECTIONS}
      />
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/system-status" replace /> },
      { path: 'system-status', element: <StatusPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
