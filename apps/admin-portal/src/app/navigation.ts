import type { Permission } from '@marketplace/shared-types';
import type { SidebarNavItem, SidebarNavSection } from '@marketplace/ui';
import {
  ActivityIcon,
  BanknoteIcon,
  CreditCardIcon,
  LandmarkIcon,
  RotateCcwIcon,
  ScaleIcon,
  TruckIcon,
  Undo2Icon,
  BoxesIcon,
  FolderTreeIcon,
  PackageSearchIcon,
  TagIcon,
  BriefcaseBusinessIcon,
  BuildingIcon,
  HardDriveIcon,
  ImageIcon,
  KeyRoundIcon,
  ReceiptIcon,
  SettingsIcon,
  StarIcon,
  TicketPercentIcon,
  ListChecksIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
} from 'lucide-react';

type NavEntry = SidebarNavItem & { permission?: Permission };

/**
 * Navigation lists only working pages the user may open.
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
      items: [
        { to: '/system-health', label: 'System health', icon: ActivityIcon },
        {
          to: '/settings',
          label: 'Settings',
          icon: SettingsIcon,
          permission: 'settings.manage',
        },
      ],
    },
    {
      title: 'Sales',
      items: [
        { to: '/orders', label: 'Orders', icon: ReceiptIcon, permission: 'orders.read' },
        {
          to: '/disputes',
          label: 'Returns and disputes',
          icon: RotateCcwIcon,
          permission: 'orders.read',
        },
        { to: '/shipping', label: 'Shipping', icon: TruckIcon, permission: 'orders.read' },
        {
          to: '/promotions',
          label: 'Promotions',
          icon: TicketPercentIcon,
          permission: 'marketing.manage',
        },
        {
          to: '/storefront',
          label: 'Storefront content',
          icon: ImageIcon,
          permission: 'marketing.manage',
        },
        { to: '/reviews', label: 'Reviews', icon: StarIcon, permission: 'reviews.moderate' },
      ],
    },
    {
      title: 'Finance',
      items: [
        { to: '/payments', label: 'Payments', icon: CreditCardIcon, permission: 'payments.read' },
        {
          to: '/bank-transfers',
          label: 'Bank transfers',
          icon: LandmarkIcon,
          permission: 'payments.read',
        },
        { to: '/cod', label: 'Cash on delivery', icon: BanknoteIcon, permission: 'payments.read' },
        { to: '/refunds', label: 'Refunds', icon: Undo2Icon, permission: 'payments.read' },
        {
          to: '/reconciliation',
          label: 'Reconciliation',
          icon: ScaleIcon,
          permission: 'payments.read',
        },
      ],
    },
    {
      title: 'Marketplace',
      items: [
        {
          to: '/sellers',
          label: 'Sellers',
          icon: BriefcaseBusinessIcon,
          permission: 'sellers.read',
        },
        { to: '/stores', label: 'Stores', icon: StoreIcon, permission: 'stores.read' },
      ],
    },
    {
      title: 'Catalog',
      items: [
        {
          to: '/catalog/products',
          label: 'Products',
          icon: PackageSearchIcon,
          permission: 'catalog.products.read',
        },
        {
          to: '/catalog/categories',
          label: 'Categories',
          icon: FolderTreeIcon,
          permission: 'catalog.categories.manage',
        },
        {
          to: '/catalog/brands',
          label: 'Brands',
          icon: TagIcon,
          permission: 'catalog.brands.manage',
        },
        { to: '/inventory', label: 'Inventory', icon: BoxesIcon, permission: 'inventory.read' },
      ],
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
          label: 'Roles',
          icon: KeyRoundIcon,
          permission: 'roles.read',
        },
        {
          to: '/permissions',
          label: 'Permissions',
          icon: ShieldIcon,
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
