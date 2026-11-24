import type { Permission } from '@marketplace/shared-types';
import type { SidebarNavItem, SidebarNavSection } from '@marketplace/ui';
import {
  ActivityIcon,
  BadgeCheckIcon,
  BuildingIcon,
  LayoutDashboardIcon,
  StoreIcon,
  UserCogIcon,
  UsersIcon,
} from 'lucide-react';

type NavEntry = SidebarNavItem & { permission?: Permission };

/** Seller Center navigation: only pages the employee may open. Products, inventory and orders come in later phases. */
export function buildNavSections(permissions: readonly Permission[]): SidebarNavSection[] {
  const allowed = (items: NavEntry[]) =>
    items.filter((i) => !i.permission || permissions.includes(i.permission));
  return [
    {
      title: 'Business',
      items: allowed([
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboardIcon },
        { to: '/profile', label: 'Business profile', icon: BuildingIcon },
        { to: '/verification', label: 'Verification', icon: BadgeCheckIcon },
        { to: '/stores', label: 'Stores', icon: StoreIcon },
        {
          to: '/employees',
          label: 'Employees',
          icon: UsersIcon,
          permission: 'seller.members.read',
        },
      ]),
    },
    {
      title: 'Me',
      items: [
        { to: '/account', label: 'Account settings', icon: UserCogIcon },
        { to: '/system-status', label: 'System status', icon: ActivityIcon },
      ],
    },
  ].filter((section) => section.items.length > 0);
}
