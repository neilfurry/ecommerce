import type { Permission } from '@marketplace/shared-types';
import type { SidebarNavItem, SidebarNavSection } from '@marketplace/ui';
import {
  ActivityIcon,
  ArrowLeftRightIcon,
  BadgeCheckIcon,
  BoxesIcon,
  HistoryIcon,
  PackageIcon,
  BuildingIcon,
  LayoutDashboardIcon,
  StoreIcon,
  UserCogIcon,
  UsersIcon,
  WarehouseIcon,
} from 'lucide-react';

type NavEntry = SidebarNavItem & { permission?: Permission };

/** Seller Center navigation: only pages the employee may open. Orders come in a later phase. */
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
      title: 'Catalog',
      items: allowed([
        { to: '/products', label: 'Products', icon: PackageIcon },
        { to: '/inventory', label: 'Inventory', icon: BoxesIcon, end: true },
        { to: '/inventory/warehouses', label: 'Warehouses', icon: WarehouseIcon },
        {
          to: '/inventory/adjustments',
          label: 'Stock adjustments',
          icon: ArrowLeftRightIcon,
          permission: 'seller.inventory.manage',
        },
        { to: '/inventory/history', label: 'Movement history', icon: HistoryIcon },
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
