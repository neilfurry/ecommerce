import {
  useAddresses,
  useMyOrders,
  useMyReviews,
  useMyWholesaleApplication,
  useSession,
  useWishlist,
} from '@marketplace/api-client';
import { ORDER_STATUS_LABELS } from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  formatMoney,
  PageHeader,
  Skeleton,
} from '@marketplace/ui';
import { BuildingIcon, UserIcon } from 'lucide-react';
import { Link } from 'react-router';

/** Customer dashboard: classification, recent orders and shortcuts. */
export function AccountOverviewPage() {
  const session = useSession();
  const user = session.data?.user;
  const wholesale = useMyWholesaleApplication();
  const orders = useMyOrders({ page: 1, pageSize: 3 });
  const wishlist = useWishlist();
  const reviews = useMyReviews();
  const addresses = useAddresses();
  const isWholesale = user?.roles.includes('WHOLESALE_CUSTOMER');
  const application = wholesale.data?.application;
  const defaultAddress = addresses.data?.find((a) => a.isDefault);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.firstName ?? ''}`}
        description="Your orders, saved items and account in one place."
      />
      {user && !user.emailVerified ? (
        <Alert>
          <AlertDescription>
            Your email address is not confirmed yet. Open the link we emailed you, or{' '}
            <Link to="/account/settings" className="font-medium text-primary underline">
              send a new confirmation link
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {isWholesale ? (
                <BuildingIcon className="size-4" aria-hidden="true" />
              ) : (
                <UserIcon className="size-4" aria-hidden="true" />
              )}{' '}
              Account type
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xl font-semibold" data-testid="account-type">
              {isWholesale ? 'Wholesale' : 'Retail'}
            </p>
            {isWholesale ? (
              <p className="text-sm text-muted-foreground">
                You get wholesale prices on products that offer them.
              </p>
            ) : application?.status === 'PENDING' ? (
              <Badge variant="secondary">Wholesale application under review</Badge>
            ) : application?.status === 'REJECTED' ? (
              <p className="text-sm text-muted-foreground">
                Your wholesale application was not approved.{' '}
                <Link to="/account/settings" className="text-primary underline">
                  See why
                </Link>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Buying for a business?{' '}
                <Link to="/account/settings" className="text-primary underline">
                  Apply for wholesale prices
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saved and to review
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <Link to="/account/wishlist" className="font-semibold hover:underline">
                {wishlist.data?.items.length ?? '–'}
              </Link>{' '}
              saved products
            </p>
            <p>
              <Link to="/account/reviews" className="font-semibold hover:underline">
                {reviews.data?.toReview.length ?? '–'}
              </Link>{' '}
              items to review
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Default address
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {addresses.isPending ? (
              <Skeleton className="h-10" />
            ) : defaultAddress ? (
              <p>
                <span className="font-medium">{defaultAddress.recipientName}</span>
                <span className="block text-muted-foreground">{defaultAddress.formatted}</span>
              </p>
            ) : (
              <Link to="/account/addresses" className="text-primary underline">
                Add an address
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Recent orders</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/account/orders">All orders</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {orders.isPending ? (
            <Skeleton className="h-24" />
          ) : orders.data && orders.data.items.length > 0 ? (
            <ul className="divide-y">
              {orders.data.items.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <Link to={`/account/orders/${o.id}`} className="font-medium hover:underline">
                    {o.orderNumber}
                  </Link>
                  <span className="text-muted-foreground">
                    {new Date(o.placedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                  </span>
                  <Badge variant={o.status === 'CANCELLED' ? 'secondary' : 'default'}>
                    {ORDER_STATUS_LABELS[o.status]}
                  </Badge>
                  <span className="font-medium">{formatMoney(o.grandTotal)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No orders yet.{' '}
              <Link to="/search" className="text-primary underline">
                Start shopping
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
