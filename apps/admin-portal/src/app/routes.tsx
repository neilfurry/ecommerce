import { APP_NAME } from '@marketplace/config';
import {
  BrandMark,
  NotFound,
  RouteError,
  SidebarLayout,
  type SidebarNavSection,
} from '@marketplace/ui';
import { ActivityIcon, HardDriveIcon, ListChecksIcon, ShieldCheckIcon } from 'lucide-react';
import { Navigate, type RouteObject } from 'react-router';
import { DEV_TOOLS_UI_ENABLED } from '../lib/env';
import { FilesPage } from '../pages/dev-tools/files-page';
import { JobsPage } from '../pages/dev-tools/jobs-page';
import { StatusPage } from '../pages/status-page';

/**
 * Navigation lists only working pages. Seller approval, catalog moderation, orders, finance
 * and settings sections are added by the phases that deliver them (sign-in arrives in Phase 2).
 */
export function buildNavSections(devToolsEnabled: boolean): SidebarNavSection[] {
  const sections: SidebarNavSection[] = [
    {
      title: 'Platform',
      items: [{ to: '/system-health', label: 'System health', icon: ActivityIcon }],
    },
  ];
  if (devToolsEnabled) {
    sections.push({
      title: 'Developer tools',
      items: [
        { to: '/dev-tools/jobs', label: 'Background jobs', icon: ListChecksIcon },
        { to: '/dev-tools/files', label: 'File storage', icon: HardDriveIcon },
      ],
    });
  }
  return sections;
}

export function buildRoutes(devToolsEnabled: boolean): RouteObject[] {
  return [
    {
      path: '/',
      element: (
        <SidebarLayout
          appName="Admin Console"
          appTagline={APP_NAME}
          logo={<BrandMark icon={ShieldCheckIcon} className="bg-foreground text-background" />}
          sections={buildNavSections(devToolsEnabled)}
        />
      ),
      errorElement: <RouteError />,
      children: [
        { index: true, element: <Navigate to="/system-health" replace /> },
        { path: 'system-health', element: <StatusPage /> },
        ...(devToolsEnabled
          ? [
              { path: 'dev-tools', element: <Navigate to="/dev-tools/jobs" replace /> },
              { path: 'dev-tools/jobs', element: <JobsPage /> },
              { path: 'dev-tools/files', element: <FilesPage /> },
            ]
          : []),
        { path: '*', element: <NotFound /> },
      ],
    },
  ];
}

export const routes = buildRoutes(DEV_TOOLS_UI_ENABLED);
