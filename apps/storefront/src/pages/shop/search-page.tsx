import { Breadcrumbs, PageHeader } from '@marketplace/ui';
import { useSearchParams } from 'react-router';
import { ProductListing } from '../../components/shop/product-listing';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q');
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[{ label: 'Home', to: '/' }, { label: q ? `Search: ${q}` : 'All products' }]}
      />
      <PageHeader title={q ? `Results for “${q}”` : 'All products'} />
      <ProductListing heading="all categories" />
    </div>
  );
}
