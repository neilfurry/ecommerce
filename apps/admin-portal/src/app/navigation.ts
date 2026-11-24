import type { Permission } from '@marketplace/shared-types';
import type { SidebarNavItem, SidebarNavSection } from '@marketplace/ui';
import {
  ActivityIcon,
  BriefcaseBusinessIcon,
  BuildingIcon,
  HardDriveIcon,
  KeyRoundIcon,
  ListChecksIcon,
  MessageSquareIcon,
  ScrollTextIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
} from 'lucide-react';

type NavEntry = SidebarNavItem & { permission?: Permission };

/**
 * Navigation lists only working pages the user may open. Catalog moderation, orders,
 * finance and settings are added by the phases that deliver them.
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
      items: [{ to: '/system-health', label: 'System health', icon: ActivityIcon }],
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
