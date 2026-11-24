import { useSession } from '@marketplace/api-client';
import { UserMenu } from '@marketplace/auth-ui';
import { APP_NAME } from '@marketplace/config';
import { Alert, AlertDescription, AlertTitle, BrandMark, SidebarLayout } from '@marketplace/ui';
import { AlertTriangleIcon, StoreIcon } from 'lucide-react';
import { Outlet } from 'react-router';
import { buildNavSections } from './navigation';

/** Banner for sellers that cannot sell right now. */
function SellerStatusBanner() {
  const seller = useSession().data?.user.seller;
  if (!seller || (seller.status !== 'SUSPENDED' && seller.status !== 'CLOSED')) return null;
  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangleIcon />
      <AlertTitle>
        {seller.status === 'SUSPENDED'
          ? 'Your seller account is suspended'
          : 'Your seller account is closed'}
      </AlertTitle>
      <AlertDescription>
        Your stores are hidden from shoppers and changes are paused. Contact marketplace support.
      </AlertDescription>
    </Alert>
  );
}

function Page() {
  return (
    <>
      <SellerStatusBanner />
      <Outlet />
    </>
  );
}

export function SellerLayout() {
  const session = useSession();
  return (
    <SidebarLayout
      appName="Seller Center"
      appTagline={session.data?.user.seller?.businessName ?? APP_NAME}
      logo={<BrandMark icon={StoreIcon} />}
      sections={buildNavSections(session.data?.user.permissions ?? [])}
      headerActions={<UserMenu />}
      content={<Page />}
    />
  );
}
