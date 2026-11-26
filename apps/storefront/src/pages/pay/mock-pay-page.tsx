import {
  toDisplayError,
  useFulfilmentAction,
  useMockPaymentSession,
} from '@marketplace/api-client';
import { PAYMENT_METHOD_LABELS } from '@marketplace/shared-types';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  formatMoney,
  Skeleton,
  TestModeBadge,
} from '@marketplace/ui';
import { FlaskConicalIcon } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';

/**
 * The mock payment provider's checkout page (development and tests only). It stands in for
 * GCash, Maya, card or QR Ph pages: choosing an outcome makes the mock send a signed webhook
 * to the API, exactly like a real provider. No money moves.
 */
export function MockPayPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const session = useMockPaymentSession(sessionId);
  const complete = useFulfilmentAction();
  if (session.isPending) return <Skeleton className="mx-auto h-72 max-w-md" />;
  if (session.isError) {
    return (
      <ErrorState
        message={toDisplayError(session.error)?.message ?? 'This test checkout does not exist.'}
        onRetry={() => void session.refetch()}
      />
    );
  }
  const s = session.data;
  const back = () => navigate(`/account/orders/${s.orderId}?payment=${s.paymentReference}`);
  const finish = (outcome: 'paid' | 'failed') =>
    complete.mutate((f) => f.customer.completeMock(s.id, outcome), { onSettled: back });
  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <Alert className="border-warning">
        <FlaskConicalIcon aria-hidden="true" />
        <AlertTitle>Test payment page</AlertTitle>
        <AlertDescription>
          This is the mock payment provider used for development. No money moves and nothing is
          charged.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Pay with {PAYMENT_METHOD_LABELS[s.method]} <TestModeBadge />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Order {s.orderNumber} · reference{' '}
            <span className="font-mono">{s.paymentReference}</span>
          </p>
          <p className="text-3xl font-bold" data-testid="mock-amount">
            {formatMoney(s.amount)}
          </p>
          {s.status === 'OPEN' ? (
            <div className="flex flex-col gap-2">
              <Button disabled={complete.isPending} onClick={() => finish('paid')}>
                Pay (test)
              </Button>
              <Button
                variant="outline"
                disabled={complete.isPending}
                onClick={() => finish('failed')}
              >
                Decline (test)
              </Button>
              <Button variant="ghost" onClick={back}>
                Back to the order
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p>This test checkout is {s.status.toLowerCase()}.</p>
              <Button variant="outline" onClick={back}>
                Back to the order
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
