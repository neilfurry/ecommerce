import { cn } from '@marketplace/ui';
import {
  HeartIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  PackageIcon,
  ShieldIcon,
  StarIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

const LINKS = [
  { to: '/account', label: 'Overview', icon: LayoutDashboardIcon, end: true },
  { to: '/account/orders', label: 'Orders', icon: PackageIcon },
  { to: '/account/addresses', label: 'Addresses', icon: MapPinIcon },
  { to: '/account/wishlist', label: 'Wishlist', icon: HeartIcon },
  { to: '/account/reviews', label: 'Reviews', icon: StarIcon },
  { to: '/account/settings', label: 'Profile and security', icon: ShieldIcon },
];

/** The customer's account area: side navigation on wide screens, scrolling tabs on phones. */
export function AccountLayout() {
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[14rem_1fr] lg:px-8">
      <nav aria-label="My account" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <ul className="flex gap-1 lg:flex-col">
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors hover:bg-accent',
                    isActive ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden="true" /> {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
