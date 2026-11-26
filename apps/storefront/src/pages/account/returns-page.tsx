import {
  toDisplayError,
  useFulfilmentAction,
  useMyReturn,
  useMyReturns,
} from '@marketplace/api-client';
import { RETURN_REASON_LABELS } from '@marketplace/shared-types';
import {
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PromptDialog,
  ReturnStatusBadge,
  ReturnView,
  Skeleton,
  toast,
} from '@marketplace/ui';
import { RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

const fail = (title: string) => (error: unknown) => {
  toast.error(title, { description: toDisplayError(error)?.message });
  throw error;
};

export function ReturnsPage() {
  const returns = useMyReturns({ page: 1, pageSize: 50 });
  if (returns.isPending) return <Skeleton className="h-64" />;
  if (returns.isError) {
    return (
      <ErrorState
        message={toDisplayError(returns.error)?.message ?? 'Could not load your returns.'}
        onRetry={() => void returns.refetch()}
      />
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Returns and refunds</h1>
      {returns.data.items.length === 0 ? (
        <EmptyState
          icon={RotateCcwIcon}
          title="No returns"
          description="You can request a return from a delivered order within its return window."
        />
      ) : (
        <ul className="space-y-2">
          {returns.data.items.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6 text-sm">
                  <div>
                    <Link to={`/account/returns/${r.id}`} className="font-medium hover:underline">
                      Return {r.number}
                    </Link>
                    <p className="text-muted-foreground">
                      {r.store.name} · {RETURN_REASON_LABELS[r.reason]}
                    </p>
                  </div>
                  <ReturnStatusBadge status={r.status} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShipBack({ returnId }: { returnId: string }) {
  const action = useFulfilmentAction();
  const [carrierName, setCarrierName] = useState('');
  const [tracking, setTracking] = useState('');
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void action
          .mutateAsync((f) =>
            f.customer.returns.shipBack(returnId, {
              carrierName: carrierName.trim(),
              trackingNumber: tracking.trim(),
            }),
          )
          .then(() => toast.success('Thanks! The store will confirm when it arrives.'))
          .catch(fail('Could not save the tracking number'))
          .catch(() => undefined);
      }}
    >
      <p className="text-sm">Send the item back, then tell us how:</p>
      <Label htmlFor="ship-back-courier">Courier</Label>
      <Input
        id="ship-back-courier"
        required
        minLength={2}
        value={carrierName}
        onChange={(e) => setCarrierName(e.target.value)}
      />
      <Label htmlFor="ship-back-tracking">Tracking number</Label>
      <Input
        id="ship-back-tracking"
        required
        minLength={4}
        value={tracking}
        onChange={(e) => setTracking(e.target.value)}
      />
      <Button type="submit" disabled={action.isPending}>
        I sent it
      </Button>
    </form>
  );
}

export function ReturnPage() {
  const { returnId } = useParams();
  const ret = useMyReturn(returnId);
  const action = useFulfilmentAction();
  if (ret.isPending) return <Skeleton className="h-96" />;
  if (ret.isError) {
    return (
      <ErrorState
        message={toDisplayError(ret.error)?.message ?? 'Could not load the return.'}
        onRetry={() => void ret.refetch()}
      />
    );
  }
  const r = ret.data;
  const overdue = r.status === 'REQUESTED' && new Date(r.sellerDeadline) <= new Date();
  const canEscalate = r.status === 'REJECTED' || overdue;
  const canCancel =
    ['REQUESTED', 'APPROVED', 'REJECTED', 'ESCALATED'].includes(r.status) && r.refunds.length === 0;
  const waitingItem = r.status === 'APPROVED' && r.requiresReturnShipment;
  const actions =
    canEscalate || canCancel || waitingItem ? (
      <>
        {waitingItem ? <ShipBack returnId={r.id} /> : null}
        {canEscalate ? (
          <PromptDialog
            trigger={<Button>Ask the marketplace to decide</Button>}
            title="Ask the marketplace to decide"
            description="Our support team reviews the request, the photos and the store’s answer."
            label="Why do you disagree?"
            minLength={10}
            maxLength={1000}
            confirmLabel="Send to the marketplace"
            onSubmit={(text) =>
              action
                .mutateAsync((f) => f.customer.returns.escalate(r.id, text))
                .catch(fail('Could not escalate'))
            }
          />
        ) : null}
        {canCancel ? (
          <Button
            variant="ghost"
            disabled={action.isPending}
            onClick={() =>
              void action
                .mutateAsync((f) => f.customer.returns.cancel(r.id))
                .then(() => toast.success('Return withdrawn'))
                .catch(fail('Could not withdraw'))
                .catch(() => undefined)
            }
          >
            Withdraw this return
          </Button>
        ) : null}
      </>
    ) : undefined;
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Returns', to: '/account/returns' }, { label: r.number }]} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Return {r.number}</h1>
        <p className="text-sm text-muted-foreground">
          {r.store.name} ·{' '}
          <Link to={`/account/orders/${r.orderId}`} className="hover:underline">
            order {r.orderNumber}
          </Link>
        </p>
      </div>
      <ReturnView ret={r} actions={actions} />
    </div>
  );
}
