import { toDisplayError, useSmsOutbox } from '@marketplace/api-client';
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@marketplace/ui';
import { InfoIcon, MessageSquareIcon } from 'lucide-react';
import { formatDateTime } from '../../lib/format';

/** DEVELOPMENT ONLY: text messages the mock SMS provider captured instead of sending. */
export function SmsOutboxPage() {
  const outbox = useSmsOutbox();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="SMS outbox"
        description="Sign-up and sign-in codes, newest first. Refreshes every 3 seconds."
      />
      <Alert>
        <InfoIcon />
        <AlertDescription>
          With SMS_PROVIDER=mock the worker stores texts here instead of sending them. Production
          uses a real gateway and this page is unavailable.
        </AlertDescription>
      </Alert>
      {outbox.isPending ? (
        <LoadingState />
      ) : outbox.isError ? (
        <ErrorState
          message={toDisplayError(outbox.error)?.message ?? 'Could not load the outbox.'}
          onRetry={() => void outbox.refetch()}
        />
      ) : outbox.data.messages.length === 0 ? (
        <EmptyState
          icon={MessageSquareIcon}
          title="No messages yet"
          description="Sign up or request a sign-in code in the storefront; the text appears here within a few seconds."
        />
      ) : (
        <ul className="space-y-3" aria-label="Messages">
          {outbox.data.messages.map((message) => (
            <li key={`${message.sentAt}-${message.to}`}>
              <Card>
                <CardContent className="space-y-1">
                  <p className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
                    <span className="tabular-nums">To {message.to}</span>
                    <time dateTime={message.sentAt}>{formatDateTime(message.sentAt)}</time>
                  </p>
                  <p className="font-mono text-sm" data-testid="sms-body">
                    {message.body}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
