import { APP_NAME } from '@marketplace/config';
import {
  BrandMark,
  NotFound,
  RouteError,
  SidebarLayout,
  type SidebarNavSection,
} from '@marketplace/ui';
import { ActivityIcon, ShieldCheckIcon } from 'lucide-react';
import { Navigate, type RouteObject } from 'react-router';
import { StatusPage } from '../pages/status-page';

/**
 * Navigation lists only working pages. Seller approval, catalog moderation, orders, finance
 * and settings sections are added by the phases that deliver them (sign-in arrives in Phase 2).
 */
export const NAV_SECTIONS: SidebarNavSection[] = [
  {
    title: 'Platform',
    items: [{ to: '/system-health', label: 'System health', icon: ActivityIcon }],
  },
];

export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <SidebarLayout
        appName="Admin Console"
        appTagline={APP_NAME}
        logo={<BrandMark icon={ShieldCheckIcon} className="bg-foreground text-background" />}
        sections={NAV_SECTIONS}
      />
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/system-health" replace /> },
      { path: 'system-health', element: <StatusPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
