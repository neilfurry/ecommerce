import { Card, CardDescription, CardHeader, CardTitle } from '@marketplace/ui';
import { PackageIcon, StoreIcon, WalletIcon, type LucideIcon } from 'lucide-react';

const HIGHLIGHTS: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: StoreIcon,
    title: 'Many sellers, one cart',
    description: 'Buy from several independent shops and pay for everything in a single checkout.',
  },
  {
    icon: PackageIcon,
    title: 'Retail and wholesale',
    description: 'Buy a single piece or order in bulk with quantity-based pricing for businesses.',
  },
  {
    icon: WalletIcon,
    title: 'Pay your way',
    description: 'GCash, Maya, cards, QR Ph, bank transfer and cash on delivery.',
  },
];

/**
 * Launch landing page. The product catalog replaces the "opening soon" notice in Phase 4.
 */
export function HomePage() {
  return (
    <div>
      <section className="border-b bg-gradient-to-b from-secondary to-background">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <p className="mb-3 inline-flex rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            Opening soon
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            Shop from trusted sellers across the Philippines
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            We are preparing the marketplace. Sellers are setting up their stores and the catalog
            will be available here shortly.
          </p>
        </div>
      </section>
      <section
        className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
        aria-labelledby="highlights"
      >
        <h2 id="highlights" className="sr-only">
          What to expect
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {HIGHLIGHTS.map(({ icon: Icon, title, description }) => (
            <Card key={title}>
              <CardHeader>
                <Icon className="mb-2 size-6 text-primary" aria-hidden="true" />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
