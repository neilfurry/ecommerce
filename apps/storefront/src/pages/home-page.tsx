import { toDisplayError, useHomePage } from '@marketplace/api-client';
import type { BannerDto, HomePage as Home, ProductCard as Card } from '@marketplace/validation';
import { Button, ErrorState, Skeleton } from '@marketplace/ui';
import { ChevronLeftIcon, ChevronRightIcon, StoreIcon, ZapIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CampaignStrip } from '../components/engagement/campaign-strip';
import { Countdown } from '../components/shop/countdown';
import { ProductRail } from '../components/shop/product-card';

function Section({
  title,
  link,
  children,
  id,
  aside,
}: {
  title: string;
  link?: { to: string; label: string };
  children: ReactNode;
  id: string;
  aside?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id={id} className="text-xl font-semibold tracking-tight">
            {title}
          </h2>
          {aside}
        </div>
        {link ? (
          <Link to={link.to} className="text-sm font-medium text-primary hover:underline">
            {link.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const bannerLink = (b: BannerDto, child: ReactNode) =>
  b.linkUrl ? (
    <Link to={b.linkUrl} className="block focus-visible:ring-2 focus-visible:ring-ring">
      {child}
    </Link>
  ) : (
    child
  );

function HeroCarousel({ banners }: { banners: BannerDto[] }) {
  const [index, setIndex] = useState(0);
  const count = banners.length;
  useEffect(() => {
    if (count < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), 6000);
    return () => window.clearInterval(timer);
  }, [count]);
  const banner = banners[index % count]!;
  return (
    <section
      aria-roledescription="carousel"
      aria-label="Promotions"
      className="relative overflow-hidden rounded-xl bg-muted"
    >
      {/* Slides change on a timer, so they are not announced as they rotate. */}
      <div aria-live="off">
        {bannerLink(
          banner,
          <div className="relative aspect-[16/7] sm:aspect-[16/5]">
            <img src={banner.imageUrl} alt="" className="size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent" />
            <div className="absolute inset-y-0 left-0 flex max-w-lg flex-col justify-center gap-2 p-5 text-white sm:p-10">
              <p className="text-2xl font-bold tracking-tight sm:text-4xl">{banner.title}</p>
              {banner.subtitle ? <p className="text-sm sm:text-lg">{banner.subtitle}</p> : null}
            </div>
          </div>,
        )}
      </div>
      {count > 1 ? (
        <>
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full opacity-80"
            aria-label="Previous promotion"
            onClick={() => setIndex((i) => (i - 1 + count) % count)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full opacity-80"
            aria-label="Next promotion"
            onClick={() => setIndex((i) => (i + 1) % count)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={`Show promotion ${i + 1}`}
                aria-current={i === index % count}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${i === index % count ? 'w-6 bg-white' : 'w-2 bg-white/60'}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function DefaultHero() {
  return (
    <section className="rounded-xl bg-gradient-to-br from-primary to-primary/70 p-6 text-primary-foreground sm:p-12">
      <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
        Shop from trusted sellers across the Philippines
      </h1>
      <p className="mt-3 max-w-xl text-base opacity-90 sm:text-lg">
        One cart for many stores, with wholesale prices for approved businesses.
      </p>
      <Button asChild size="lg" variant="secondary" className="mt-6">
        <Link to="/search">Start shopping</Link>
      </Button>
    </section>
  );
}

function Categories({ categories }: { categories: Home['categories'] }) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {categories.map((c) => (
        <li key={c.id}>
          <Link
            to={`/c/${c.slug}`}
            className="flex h-full flex-col items-center gap-2 rounded-lg border bg-card p-3 text-center text-sm font-medium transition-colors hover:border-primary hover:bg-accent"
          >
            <span className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-semibold text-muted-foreground">
              {c.imageUrl ? (
                <img src={c.imageUrl} alt="" className="size-full object-cover" />
              ) : (
                c.name.slice(0, 1)
              )}
            </span>
            {c.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Rail({
  products,
  title,
  id,
  link,
}: {
  products: Card[];
  title: string;
  id: string;
  link?: { to: string; label: string };
}) {
  if (products.length === 0) return null;
  return (
    <Section title={title} id={id} link={link}>
      <ProductRail products={products} />
    </Section>
  );
}

export function HomePage() {
  const home = useHomePage();
  if (home.isPending) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8" aria-label="Loading">
        <Skeleton className="aspect-[16/5] w-full rounded-xl" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (home.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState
          title="The store could not be loaded"
          message={toDisplayError(home.error)?.message ?? 'Please try again.'}
          requestId={toDisplayError(home.error)?.requestId}
          onRetry={() => void home.refetch()}
        />
      </div>
    );
  }
  const data = home.data;
  return (
    <div className="pb-4">
      <CampaignStrip />
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        {data.heroBanners.length > 0 ? (
          <>
            {/* The page heading, for screen readers and search engines, when banners lead. */}
            <h1 className="sr-only">Shop from trusted sellers across the Philippines</h1>
            <HeroCarousel banners={data.heroBanners} />
          </>
        ) : (
          <DefaultHero />
        )}
      </div>

      {data.categories.length > 0 ? (
        <Section title="Shop by category" id="home-categories">
          <Categories categories={data.categories} />
        </Section>
      ) : null}

      {data.flashSale ? (
        <Section
          title={data.flashSale.title}
          id="home-flash-sale"
          aside={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-sm font-semibold text-white">
              <ZapIcon className="size-4" aria-hidden="true" /> Ends in{' '}
              <Countdown until={data.flashSale.endsAt} />
            </span>
          }
        >
          <ProductRail products={data.flashSale.products} />
        </Section>
      ) : null}

      {data.promoBanners.length > 0 ? (
        <section
          aria-label="Promotions"
          className="mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:px-8"
        >
          {data.promoBanners.map((b) => (
            <div key={b.id} className="overflow-hidden rounded-lg border">
              {bannerLink(
                b,
                <div className="relative aspect-[3/1]">
                  <img src={b.imageUrl} alt="" className="size-full object-cover" />
                  <div className="absolute inset-0 flex flex-col justify-center bg-gradient-to-r from-black/50 to-transparent p-4 text-white">
                    <p className="text-lg font-semibold">{b.title}</p>
                    {b.subtitle ? <p className="text-sm">{b.subtitle}</p> : null}
                  </div>
                </div>,
              )}
            </div>
          ))}
        </section>
      ) : null}

      <Rail products={data.featuredProducts} title="Featured products" id="home-featured" />
      <Rail
        products={data.bestSellers}
        title="Best sellers"
        id="home-best-sellers"
        link={{ to: '/search?sort=best_selling', label: 'See all' }}
      />
      <Rail products={data.recommended} title="Recommended for you" id="home-recommended" />

      {data.featuredStores.length > 0 ? (
        <Section title="Featured stores" id="home-stores">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.featuredStores.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/s/${s.slug}`}
                  className="flex h-full items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:border-primary"
                >
                  <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                    {s.logoUrl ? (
                      <img src={s.logoUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <StoreIcon className="text-muted-foreground" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{s.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[s.city, s.province].filter(Boolean).join(', ') || s.description}
                    </span>
                    <span className="text-xs text-muted-foreground">{s.productCount} products</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
