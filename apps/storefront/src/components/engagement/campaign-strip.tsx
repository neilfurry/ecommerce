import { useEngagement } from '@marketplace/api-client';
import { TicketPercentIcon } from 'lucide-react';
import { Link } from 'react-router';

/** Running campaigns (marketplace-wide and stores'), applied automatically at checkout. */
export function CampaignStrip({ storeId }: { storeId?: string }) {
  const campaigns = useEngagement(['storefront', 'campaigns', storeId ?? 'all'], (e, s) =>
    e.storefront.campaigns(storeId, s),
  );
  const items = campaigns.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-label="Deals now" className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {items.slice(0, 12).map((c) => (
          <li key={c.id} className="min-w-56 shrink-0 rounded-lg border bg-card p-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <TicketPercentIcon className="size-4 text-primary" aria-hidden="true" />
              {c.headline}
            </p>
            <p className="text-sm">
              {c.season ? `${c.season} · ` : ''}
              {c.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {c.store ? (
                <Link to={`/s/${c.store.slug}`} className="underline">
                  {c.store.name}
                </Link>
              ) : (
                'All stores'
              )}{' '}
              · until {new Date(c.endsAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
