import { hasPermission, useSession } from '@marketplace/api-client';
import { UserMenu } from '@marketplace/auth-ui';
import { APP_NAME } from '@marketplace/config';
import { BrandMark, SidebarLayout } from '@marketplace/ui';
import { ShieldCheckIcon } from 'lucide-react';
import { Navigate } from 'react-router';
import { buildNavSections } from './navigation';

export function AdminLayout({ devToolsEnabled }: { devToolsEnabled: boolean }) {
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

/** Lands each user on the first page their permissions allow. */
export function HomeRedirect() {
  const session = useSession();
  return (
    <Navigate
      to={hasPermission(session.data, 'users.read') ? '/users' : '/system-health'}
      replace
    />
  );
}
