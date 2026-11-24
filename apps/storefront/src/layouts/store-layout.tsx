import { APP_NAME } from '@marketplace/config';
import { BrandMark, cn } from '@marketplace/ui';
import { Link, NavLink, Outlet } from 'react-router';

const NAV_LINKS = [{ to: '/', label: 'Home', end: true }];

export function StoreLayout() {
  const year = new Date().getFullYear();
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 rounded-md font-semibold">
            <BrandMark />
            <span className="text-lg">{APP_NAME}</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t bg-muted/40">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            © {year} {APP_NAME}. Prices in Philippine Peso (₱).
          </p>
          <Link to="/status" className="hover:text-foreground hover:underline">
            System status
          </Link>
        </div>
      </footer>
    </div>
  );
}
