import type { LucideIcon } from 'lucide-react';
import { MenuIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Button } from '../components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/sheet';
import { cn } from '../lib/utils';

export interface SidebarNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly (use for index routes). */
  end?: boolean;
}

export interface SidebarNavSection {
  title?: string;
  items: SidebarNavItem[];
}

export interface SidebarLayoutProps {
  /** Product name shown at the top of the sidebar, e.g. "Seller Center". */
  appName: string;
  /** Short line under the name, e.g. "Marketplace". */
  appTagline?: string;
  logo: ReactNode;
  sections: SidebarNavSection[];
  /** Rendered on the right of the top bar (the account menu). */
  headerActions?: ReactNode;
  /** Page content; defaults to the nested routes (<Outlet />). */
  content?: ReactNode;
}

function SidebarNav({
  sections,
  onNavigate,
}: {
  sections: SidebarNavSection[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-6 p-3">
      {sections.map((section, index) => (
        <div key={section.title ?? index} className="flex flex-col gap-1">
          {section.title ? (
            <p className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {section.title}
            </p>
          ) : null}
          {section.items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                )
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Brand({
  appName,
  appTagline,
  logo,
}: Pick<SidebarLayoutProps, 'appName' | 'appTagline' | 'logo'>) {
  return (
    <div className="flex items-center gap-3">
      {logo}
      <div className="leading-tight">
        <p className="font-semibold">{appName}</p>
        {appTagline ? <p className="text-xs text-muted-foreground">{appTagline}</p> : null}
      </div>
    </div>
  );
}

/**
 * Responsive shell for the seller and admin portals: a fixed sidebar on large screens and a
 * slide-out navigation sheet on tablets and phones. Pages render through <Outlet />.
 */
export function SidebarLayout({
  appName,
  appTagline,
  logo,
  sections,
  headerActions,
  content,
}: SidebarLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-svh flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 items-center border-b px-5">
          <Brand appName={appName} appTagline={appTagline} logo={logo} />
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav sections={sections} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0">
              <SheetHeader className="border-b">
                <SheetTitle asChild>
                  <div>
                    <Brand appName={appName} appTagline={appTagline} logo={logo} />
                  </div>
                </SheetTitle>
                <SheetDescription className="sr-only">Main navigation</SheetDescription>
              </SheetHeader>
              <SidebarNav sections={sections} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="lg:hidden">
            <Brand appName={appName} logo={logo} />
          </div>
          <div className="ml-auto flex items-center gap-2">{headerActions}</div>
        </header>
        <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-8">
          {content ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
