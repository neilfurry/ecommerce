import type { Permission } from '@marketplace/shared-types';
import type { SidebarNavItem, SidebarNavSection } from '@marketplace/ui';
import {
  ActivityIcon,
  ArrowLeftRightIcon,
  BadgeCheckIcon,
  BoxesIcon,
  HistoryIcon,
  PackageIcon,
  ReceiptIcon,
  RotateCcwIcon,
  WalletIcon,
  TicketPercentIcon,
  ZapIcon,
  BuildingIcon,
  LayoutDashboardIcon,
  StoreIcon,
  UserCogIcon,
  UsersIcon,
  WarehouseIcon,
} from 'lucide-react';

type NavEntry = SidebarNavItem & { permission?: Permission };

/** Seller Center navigation: only pages the employee may open. */
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
      title: 'Sales',
      items: allowed([
        {
          to: '/orders',
          label: 'Orders',
          icon: ReceiptIcon,
          permission: 'seller.orders.read',
        },
        { to: '/returns', label: 'Returns', icon: RotateCcwIcon, permission: 'seller.orders.read' },
        { to: '/payables', label: 'Payables', icon: WalletIcon, permission: 'seller.orders.read' },
        { to: '/marketing/coupons', label: 'Coupons', icon: TicketPercentIcon },
        { to: '/marketing/flash-sales', label: 'Flash sales', icon: ZapIcon },
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
