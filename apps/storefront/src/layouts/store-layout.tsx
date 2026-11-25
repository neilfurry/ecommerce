import { APP_NAME } from '@marketplace/config';
import { useSession } from '@marketplace/api-client';
import { UserMenu } from '@marketplace/auth-ui';
import {
  BrandMark,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@marketplace/ui';
import { HeartIcon, MenuIcon, PackageIcon, ShoppingCartIcon, UserIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { CategoryMenu } from '../components/shop/category-menu';
import { useCategoryTree } from '../hooks/use-category-tree';
import { SearchBox } from '../components/shop/search-box';
import { useShoppingCart } from '../hooks/use-shopping-cart';

function CartButton() {
  const { count } = useShoppingCart();
  return (
    <Button asChild variant="ghost" size="sm" className="relative">
      <Link
        to="/cart"
        aria-label={count > 0 ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart'}
      >
        <ShoppingCartIcon aria-hidden="true" />
        <span className="hidden lg:inline">Cart</span>
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

/** Sign-in links for visitors; account link and menu for signed-in customers. */
function AccountActions() {
  const session = useSession();
  if (session.isPending) return null;
  if (session.data) {
    return (
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
          <Link to="/account">
            <UserIcon aria-hidden="true" /> <span className="hidden lg:inline">My account</span>
            <span className="sr-only lg:hidden">My account</span>
          </Link>
        </Button>
        <UserMenu />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link to="/sign-in">Sign in</Link>
      </Button>
      <Button asChild size="sm">
        <Link to="/sign-up">Create account</Link>
      </Button>
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const { roots, childrenOf } = useCategoryTree();
  const session = useSession();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
          <MenuIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{APP_NAME}</SheetTitle>
        </SheetHeader>
        <nav
          aria-label="Mobile"
          className="space-y-4 px-4 pb-6 text-sm"
          onClick={() => setOpen(false)}
        >
          <div className="space-y-1">
            <Link to="/search" className="block rounded px-2 py-2 hover:bg-accent">
              All products
            </Link>
            {session.data ? (
              <>
                <Link to="/account/orders" className="block rounded px-2 py-2 hover:bg-accent">
                  My orders
                </Link>
                <Link to="/account/wishlist" className="block rounded px-2 py-2 hover:bg-accent">
                  Wishlist
                </Link>
                <Link to="/account" className="block rounded px-2 py-2 hover:bg-accent">
                  My account
                </Link>
              </>
            ) : (
              <Link to="/sign-up" className="block rounded px-2 py-2 hover:bg-accent">
                Create account
              </Link>
            )}
          </div>
          <div>
            <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Categories
            </p>
            {roots.map((root) => (
              <div key={root.id}>
                <Link
                  to={`/c/${root.slug}`}
                  className="block rounded px-2 py-2 font-medium hover:bg-accent"
                >
                  {root.name}
                </Link>
                {childrenOf(root.id).map((child) => (
                  <Link
                    key={child.id}
                    to={`/c/${child.slug}`}
                    className="block rounded py-1.5 pr-2 pl-6 text-muted-foreground hover:bg-accent"
                  >
                    {child.name}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function Footer() {
  const { roots } = useCategoryTree();
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t bg-muted/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="space-y-2">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <BrandMark /> {APP_NAME}
          </Link>
          <p className="text-muted-foreground">
            Many sellers, one cart. Retail and wholesale prices for shoppers and businesses across
            the Philippines.
          </p>
        </div>
        <nav aria-label="Shop by category">
          <h2 className="mb-2 font-semibold">Shop</h2>
          <ul className="space-y-1.5 text-muted-foreground">
            {roots.slice(0, 6).map((c) => (
              <li key={c.id}>
                <Link to={`/c/${c.slug}`} className="hover:text-foreground hover:underline">
                  {c.name}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/search?sort=newest" className="hover:text-foreground hover:underline">
                New arrivals
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Your account">
          <h2 className="mb-2 font-semibold">Your account</h2>
          <ul className="space-y-1.5 text-muted-foreground">
            <li>
              <Link to="/account/orders" className="hover:text-foreground hover:underline">
                Orders
              </Link>
            </li>
            <li>
              <Link to="/account/wishlist" className="hover:text-foreground hover:underline">
                Wishlist
              </Link>
            </li>
            <li>
              <Link to="/account/addresses" className="hover:text-foreground hover:underline">
                Addresses
              </Link>
            </li>
            <li>
              <Link to="/account/settings" className="hover:text-foreground hover:underline">
                Wholesale account
              </Link>
            </li>
          </ul>
        </nav>
        <div>
          <h2 className="mb-2 font-semibold">Good to know</h2>
          <ul className="space-y-1.5 text-muted-foreground">
            <li className="flex gap-2">
              <PackageIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Each store ships
              its own items.
            </li>
            <li className="flex gap-2">
              <HeartIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Prices include 12%
              VAT.
            </li>
            <li>
              <Link to="/status" className="hover:text-foreground hover:underline">
                System status
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t px-4 py-4 text-center text-xs text-muted-foreground">
        © {year} {APP_NAME}. Prices in Philippine Peso (₱).
      </p>
    </footer>
  );
}

export function StoreLayout() {
  const location = useLocation();
  const checkout = location.pathname.startsWith('/checkout');
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
          <MobileMenu />
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 rounded-md font-semibold"
            aria-label={`${APP_NAME} home`}
          >
            <BrandMark />
            <span className="hidden text-lg lg:inline">{APP_NAME}</span>
          </Link>
          <nav aria-label="Main" className="hidden md:block">
            <CategoryMenu />
          </nav>
          {checkout ? <div className="flex-1" /> : <SearchBox className="hidden flex-1 sm:block" />}
          <div className="ml-auto flex items-center gap-1">
            <CartButton />
            <AccountActions />
          </div>
        </div>
        {checkout ? null : (
          <div className="border-t px-4 py-2 sm:hidden">
            <SearchBox />
          </div>
        )}
      </header>

      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
