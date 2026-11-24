import { UserMenu } from '@marketplace/auth-ui';
import { APP_NAME } from '@marketplace/config';
import { BrandMark, SidebarLayout, type SidebarNavSection } from '@marketplace/ui';
import { ActivityIcon, StoreIcon } from 'lucide-react';

/**
 * Navigation lists only working pages. Store, product, inventory and order sections are
 * added by the phases that deliver them (seller onboarding is Phase 3).
 */
const NAV_SECTIONS: SidebarNavSection[] = [
  {
    title: 'Support',
    items: [{ to: '/system-status', label: 'System status', icon: ActivityIcon }],
  },
];

export function SellerLayout() {
  return (
    <SidebarLayout
      appName="Seller Center"
      appTagline={APP_NAME}
      logo={<BrandMark icon={StoreIcon} />}
      sections={NAV_SECTIONS}
      headerActions={<UserMenu />}
    />
  );
}
